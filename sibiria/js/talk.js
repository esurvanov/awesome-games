'use strict';
// Talk — постановка разговора в мире: видно лица, кто говорит и как, что между людьми происходит.
// Сюжетный разговор (UI.dialog): камера плавно подъезжает (≈2.8×, ручной зум игрока не трогаем) и держит пару в кадре;
// собеседник подходит на разговорную дистанцию, оба встают лицом друг к другу вполоборота к камере (¾ — лица видны).
// Реплика — пузырь над говорящим с хвостиком к голове, печатается вместе с речью: рот и борода двигаются по гласным,
// жесты по смыслу (показывает на место из текста, разводит руками, машет, греет руки, качает головой, пожимает плечами,
// кладёт руку на плечо, рубит ладонью, рука к сердцу), слушающий кивает на точках и смотрит, куда показали.
// Мимика по тону реплики (тревога, радость, усталость, злость, горе, холод, вопрос) — брови, глаза, рот; ответ героя — его пузырь.
// Передача вещи: изменение инвентаря в узле (act/run, js/ui.js → give) — один протягивает, другой берёт и убирает в рюкзак.
// Бытовые реплики (Barks.say): пузырь + жест и мимика, без камеры.
// Состояние — в памяти модуля (не в G): сейвы не меняются. Своя случайность — Math.random игры не тратится.
// Контракт: line(node) / reply(text) / give(diff) / end() — js/ui.js; tick(dt) — UI.frame; draw(g) — gfx (слой ui);
// bark(o, text, {to, life}) — js/barks.js; ArtPeople.setDirector — правка позы и мимики участников в момент рисования.
const Talk = (() => {
  const rnd = mulberry(0x7A1C0DE);
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
  const W = s => new RegExp('(^|[^а-яa-z])(' + s + ')');
  const at = (re, s) => { const m = re.exec(s); return m ? m.index + m[1].length : -1; };
  const clean = s => String(s || '').replace(/:[a-z0-9_-]+:/gi, '').replace(/\s+/g, ' ').trim();
  const sgn = v => (v < 0 ? -1 : 1);

  // ---------- тон реплики → мимика (порядок — важность) ----------
  const EMO = {
    fear: { brow: 0.6, knit: -0.7, smile: -0.25, open: 1.4, jaw: 0.25 },
    joy: { brow: 0.15, knit: 0, smile: 0.85, open: 0.8 },
    tired: { brow: -0.15, knit: -0.35, smile: -0.2, open: 0.55 },
    anger: { brow: -0.4, knit: 1, smile: -0.55, open: 0.9 },
    grief: { brow: 0.1, knit: -0.95, smile: -0.75, open: 0.62 },
    cold: { brow: -0.2, knit: 0.45, smile: -0.35, open: 0.6 },
    ask: { brow: 0.55, knit: -0.1, smile: 0.05, open: 1.18 },
  };
  const TONE = [
    ['grief', W('умер|погиб|не просну|похорон|семеныч|разреву|не прилетел|не пришла|помянуть|жалко|жаль')],
    ['fear', W('волк|шатун|амак|медвед|стая|беги|бегом|осторожн|опасн|бойся|страшн|воют|кровь|кровью|берегись|не выходи|горим|пожар')],
    ['anger', W('дурак|зачем ты|не трогай|вор[ауы]?[ ,.!]|украл|черт|ругать|врешь|балбес|сдурел')],
    ['cold', W('мороз|холод|замерз|минус|пальцев|стуж|отогре|околе|зуб на зуб')],
    ['tired', W('устал|нога |ногу|не дойду|сил нет|дохромаю|хромаю|отдохн|спать хочу|лежачий|одной ноге')],
    ['joy', W('спасибо|живые|живой|ура|наконец|хорош|красиво|молодец|рад[аы]? |вкусно|шучу|добр[оы]|дорова|здравствуй|садится|с чаем|приятно|баня|баню')],
  ];
  function toneOf(n) {
    let best = null, bi = 1e9;
    for (const [k, re] of TONE) { const i = at(re, n); if (i >= 0) { best = k; bi = i; break; } }
    if (!best && /!/.test(n)) best = 'joy';
    if (!best && /\?\s*$/.test(n)) best = 'ask';
    return best;
  }
  // ---------- смысл реплики → жесты (где в тексте — там и жест) ----------
  const GEST = [
    ['wave', W('дорова|здравствуй|привет|прощай|бывай|до встречи|пока[ .!,]|пока$|лети[ .!,]|эй[,!]')],
    ['warm', W('мороз|холод|замерз|пальц|отогре|погрей|грей|зуб на зуб')],
    ['shoulder', W('держись|не бойся|не плачь|справимся|потерпи|не отвечай мне|стой рядом|ты молодец')],
    ['heart', W('умер|погиб|семеныч|помянуть|жалко|разреву|не просну')],
    ['shake', W('нет[ .!,]|нет$|не дам|нельзя|не надо|не выйдет|не пойдет|не шучу|не жди|не трогай|не бери')],
    ['shrug', W('не знаю|может|или |видимо|наверно|кто знает|как знать|бывает|то ли')],
    ['spread', W('все\\.|кончил|ничего нет|пусто|нечем|вот так|что поделаешь|куда деваться|сами пойдем')],
    ['beckon', W('пошли|идем|пойдем|за мной|айда')],
    ['head', W('устал|голова|думаю|подумай|вспомни|помню')],
    ['nod', W('да[ ,.!]|хорошо|ладно|понял|согласен|договорились|верно|правильно|так и есть|конечно')],
    ['chop', W('должен|надо|нужно|обязательно|запомни|слушай|главное|только')],
  ];
  // места из текста → точка в мире (куда показать рукой)
  const zoneAt = id => () => { const z = typeof ZONES !== 'undefined' && ZONES[id]; return z && z.active && z.x != null ? z : null; };
  const PLACES = [
    [W('мар[ьиюе]'), () => POI.mar], [W('чум'), () => POI.chum], [W('изб[ауеы]|зимовь'), () => HUT], [W('хвост'), () => POI.tail],
    [W('кабин|обломк|приборк'), () => POI.cockpit], [W('перекат|вверх по реке|к реке|вдоль реки|по реке'), () => POI.polynya],
    [W('лабаз'), () => POI.labaz], [W('кедрач'), () => POI.cedar],
    [W('кербо|метеостанц'), zoneAt('meteo')], [W('буров|у вахты'), zoneAt('drill')], [W('стойбищ'), zoneAt('stoibishe')],
    [W('зимник|«урал'), zoneAt('zimnik')], [W('гар[ьи]'), zoneAt('gar')], [W('налед'), zoneAt('naled')], [W('курум'), zoneAt('kurum')], [W('голец|гольц'), zoneAt('golets')],
  ];
  const DIRS = [[W('северо-запад'), -0.7, -0.7], [W('северо-восток'), 0.7, -0.7], [W('юго-запад'), -0.7, 0.7], [W('юго-восток'), 0.7, 0.7],
    [W('север'), 0, -1], [W('юг[ауео ]'), 0, 1], [W('запад'), -1, 0], [W('восток'), 1, 0]];
  // жесты реплики: [{k, at (доля текста), pt (куда показать)}] — не больше двух, не ближе трети текста
  function gestOf(n, from) {
    const L = Math.max(1, n.length), out = [];
    const add = (k, i, pt) => { const a = i / L; if (out.some(q => Math.abs(q.at - a) < 0.3) || out.length >= 2) return; out.push({ k, at: Math.min(0.85, a), pt }); };
    // место или сторона света — показать
    for (const [re, f] of PLACES) { const i = at(re, n); if (i >= 0) { const q = f(); if (q && from && Math.hypot(q.x - from.x, q.y - from.y) > 60) { add('point', i, { x: q.x, y: q.y }); break; } } }
    if (!out.length && from) for (const [re, dx, dy] of DIRS) { const i = at(re, n); if (i >= 0) { add('point', i, { x: from.x + dx * 600, y: from.y + dy * 600 }); break; } }
    for (const [k, re] of GEST) { const i = at(re, n); if (i >= 0) add(k, i); }
    out.sort((a, b) => a.at - b.at);
    return out;
  }
  // вещи инвентаря → что видно в руке (ArtPeople drawTool)
  const HELD = { meat: 'meat', fish: 'fish', dried: 'dried', can: 'can', stew: 'bowl', honey: 'jar', tea: 'cup', hare: 'fur', sable: 'furD', wpelt: 'furG',
    kero: 'kero', cable: 'coil', snare: 'coil', trap: 'trap', scrap: 'scrap', wood: 'log', quartz: 'amulet', tube: 'tube', battery: 'bundle', antenna: 'coil' };
  // вещь из текста, если инвентарь не менялся (мазь, записка, кружка): только показать
  const TXT_ITEM = [[W('кружк|чаю попей|пей чай'), 'cup'], [W('мазь'), 'jar'], [W('записк|письм|бумаг'), 'paper'], [W('ламп'), 'tube'], [W('мяс[оа]'), 'meat'], [W('костыл'), 'bundle']];
  const GIVE_RE = W('держи|бери[ .,!]|возьми|на,|вот тебе|вот, смотри|передай');

  // ---------- позы разговора (ArtPeople.register) ----------
  const AP = ArtPeople, H = AP.H, P = H.P, PI = Math.PI, sin = Math.sin;
  const { lerp, sm, clamp: cl, seg, shoulder, handR } = H;
  const envA = (a, a0, a1, a2, a3) => sm((a - a0) / (a1 - a0)) * (1 - sm((a - a2) / (a3 - a2)));
  const R0 = [1.4, 12.2], R1 = [-1, 12.3];
  // путь кисти — по дуге вокруг плеча (угол и радиус), а не по прямой: рука не «проходит сквозь» плечо, локоть не перещёлкивает
  function polar(x0, y0, x1, y1, e) {
    const a0 = Math.atan2(y0, x0), a1 = Math.atan2(y1, x1), r0 = Math.hypot(x0, y0), r1 = Math.hypot(x1, y1);
    let d = a1 - a0; while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI;
    const a = a0 + d * e, r = Math.max(lerp(r0, r1, e), Math.min(r0, r1, 9.5));
    return [Math.cos(a) * r, Math.sin(a) * r];
  }
  const hand = (i, dx, dy, w) => { const r = i ? R1 : R0, q = polar(r[0], r[1], dx, dy, cl(w, 0, 1)); handR(i, q[0], q[1]); };
  const pAbs = (x0, y0, x1, y1, e) => { const q = polar(x0 - P.sx, y0 - P.sy, x1 - P.sx, y1 - P.sy, e); return [P.sx + q[0], P.sy + q[1]]; };
  const handAt = (i, x, y, w) => hand(i, x - P.sx, y - P.sy, w);
  const body = (lean, hy) => { P.lean = lean; P.hy = hy; shoulder(); };
  const tg = (o, x, y) => (o.target && isFinite(o.target.x) && isFinite(o.target.y) ? o.target : { x, y });
  const gi = () => 0;   // жест — ближней рукой (с посохом — посох в дальней: staffHand)
  const belt = o => { if (o.tool === 'axe' && H.belt) H.belt('axe'); };
  const setHl = (i, v) => { if (i) P.hl1 = v; else P.hl0 = v; };
  const R = (name, spec) => AP.register(name, Object.assign({ staff: true, staffHand: 1 }, spec));
  if (AP.POSE.listen) { AP.POSE.listen.staff = true; AP.POSE.listen.staffHand = 1; }   // слушает — посох в дальней руке (не заслоняет лицо)
  // говорит: ближняя рука объясняет (плавные круги у груди), корпус чуть вперёд; рот — от постановщика (по гласным)
  R('tTalk', { dur: 2, loop: true, fn(o, t) {
    H.idle(o, t); belt(o); const gt = t * 2.3;
    body(0.06 + 0.03 * sin(t * 1.1), -17.2);
    hand(0, 6 + 2.2 * sin(gt), 6.2 + 2.6 * Math.cos(gt * 1.3), 1); P.hl0 = 5;
    hand(1, 3 + 1.2 * sin(gt * 0.7 + 1), 9.5 + 1.6 * sin(gt * 1.1), 1);
    P.tilt = 0.06 * sin(t * 5);
  } });
  // показать: рука вытянута к цели (o.target — точка в координатах рига), голова следом
  R('tPoint', { dur: 1.9, fn(o, t, a) {
    H.idle(o, t); belt(o); const i = gi(), T = tg(o, 24, -44), w = envA(a, 0.04, 0.26, 0.8, 0.98);
    body(0.04 + 0.05 * w, -17.2);
    const dx = T.x - P.sx, dy = T.y - P.sy, d = Math.hypot(dx, dy) || 1;
    handAt(i, P.sx + dx / d * 13.2, P.sy + dy / d * 13.2, w); setHl(i, lerp(6.6, 4.2, w));
    if (!i) hand(1, R1[0], R1[1], 1);
    P.tilt = lerp(0, cl(dy / d, -0.6, 0.4) * 0.35, w);
  } });
  // развести руками: ладони вперёд-в стороны, голова чуть назад
  R('tSpread', { dur: 1.5, fn(o, t, a) {
    H.idle(o, t); belt(o); const w = envA(a, 0.05, 0.3, 0.7, 0.96);
    body(0.02 - 0.02 * w, -17.2);
    if (!gi()) { hand(0, 7.4, 6.4, w); P.hl0 = lerp(6.6, 9, w); }
    hand(1, 6.2, 6.8, w); P.hl1 = lerp(6.6, 9, w);
    P.tilt = -0.08 * w; P.hb = -0.3 * w;
  } });
  // пожать плечами: плечи вверх, кисти раскрыты низко, голова набок
  R('tShrug', { dur: 1.2, fn(o, t, a) {
    H.idle(o, t); belt(o); const w = envA(a, 0.05, 0.28, 0.62, 0.92);
    body(0.03, -17.2 - 0.4 * w); P.sy -= 1.1 * w;
    if (!gi()) { hand(0, 4.6, 9.6, w); P.hl0 = lerp(6.6, 8.2, w); }
    hand(1, 3.6, 10, w); P.hl1 = lerp(6.6, 8.2, w);
    P.tilt = 0.12 * w; P.hb = 0.4 * w;
  } });
  // рука на плечо собеседника (o.target — его плечо), лёгкое похлопывание
  R('tShoulder', { dur: 2.4, fn(o, t, a) {
    H.idle(o, t); belt(o); const i = gi(), T = tg(o, 15, -32), w = envA(a, 0.05, 0.3, 0.76, 0.96);
    body(0.04 + 0.1 * w, -17.2);
    const pat = a > 0.34 && a < 0.72 ? 0.45 * Math.max(0, sin(t * 9)) : 0;
    handAt(i, T.x, T.y - pat, w); setHl(i, lerp(6.6, 2.6, w));
    if (!i) hand(1, R1[0], R1[1], 1);
    P.tilt = 0.1 * w;
  } });
  // отдать вещь: рука за спину к рюкзаку → вещь протянута к точке встречи рук (o.target) → отпустил (0.55) → рука в покой
  R('tGive', { dur: 2.2, fn(o, t, a) {
    H.idle(o, t); belt(o); const T = tg(o, 12, -27), out = envA(a, 0.14, 0.4, 0.58, 0.86);
    body(0.04 + 0.1 * out, -17.2);
    const rx = P.sx + R0[0], ry = P.sy + R0[1], BK = [P.sx + 4.2, P.sy + 7.5];   // за пазухой
    let x, y, lat;
    if (a < 0.14) { const e = sm(a / 0.14); [x, y] = pAbs(rx, ry, BK[0], BK[1], e); lat = lerp(6.6, 3, e); }
    else if (a < 0.4) { const e = sm(seg(a, 0.14, 0.4)); [x, y] = pAbs(BK[0], BK[1], T.x, T.y, e); lat = lerp(3, 1, e); }
    else if (a < 0.58) { x = T.x; y = T.y + 0.25 * sin((a - 0.4) * 30); lat = 1; }
    else { const e = sm(seg(a, 0.58, 0.86)); [x, y] = pAbs(T.x, T.y, rx, ry, e); lat = lerp(1, 6.6, e); }
    P.h0x = x; P.h0y = y; P.hl0 = lat; hand(1, R1[0], R1[1], 1);
    if (o.item && a > 0.08 && a < 0.55) P.held = [o.item, x - 0.3, y - 0.6, -0.25];
    P.tilt = 0.14 * out;
  } });
  // взять вещь: рука к точке встречи (0.28–0.5) → взял (0.55) → рассмотрел у груди → в рюкзак за спину → покой
  R('tTake', { dur: 2.2, fn(o, t, a) {
    H.idle(o, t); belt(o); const T = tg(o, 12, -27), up = envA(a, 0.28, 0.5, 0.6, 0.72);
    body(0.04 + 0.08 * up, -17.2);
    const rx = P.sx + R0[0], ry = P.sy + R0[1], E = [P.sx + 8, P.sy + 2], BK = [P.sx + 4.2, P.sy + 7.5];   // рассмотрел — за пазуху
    let x = rx, y = ry, lat = 6.6;
    if (a < 0.28) { /* ждёт */ }
    else if (a < 0.5) { const e = sm(seg(a, 0.28, 0.5)); [x, y] = pAbs(rx, ry, T.x, T.y, e); lat = lerp(6.6, 1, e); }
    else if (a < 0.58) { x = T.x; y = T.y; lat = 1; }
    else if (a < 0.72) { const e = sm(seg(a, 0.58, 0.72)); [x, y] = pAbs(T.x, T.y, E[0], E[1], e); lat = lerp(1, 3, e); }
    else if (a < 0.86) { const e = sm(seg(a, 0.72, 0.86)); [x, y] = pAbs(E[0], E[1], BK[0], BK[1], e); lat = 3; }
    else { const e = sm(seg(a, 0.86, 1)); [x, y] = pAbs(BK[0], BK[1], rx, ry, e); lat = lerp(3, 6.6, e); }
    P.h0x = x; P.h0y = y; P.hl0 = lat; hand(1, R1[0], R1[1], 1);
    if (o.item && a >= 0.55 && a < 0.84) P.held = [o.item, x - 0.3, y - 0.6, -0.3];
    P.tilt = 0.1 * up + 0.22 * envA(a, 0.58, 0.64, 0.7, 0.76);
  } });
  // рубит ладонью (настойчиво объясняет): два коротких удара вниз
  R('tChop', { dur: 1.0, fn(o, t, a) {
    H.idle(o, t); belt(o); const i = gi(), w = envA(a, 0.04, 0.18, 0.82, 0.98), k = Math.abs(sin(a * PI * 2));
    body(0.05 + 0.03 * k * w, -17.2);
    hand(i, 6.8, 3.5 + 4.5 * k, w); setHl(i, lerp(6.6, 5, w)); if (!i) hand(1, R1[0], R1[1], 1);
    P.tilt = 0.06 * k * w;
  } });
  // рука к сердцу, голова опущена (горе, память)
  R('tHeart', { dur: 2.2, fn(o, t, a) {
    H.idle(o, t); belt(o); const i = gi(), w = envA(a, 0.05, 0.3, 0.76, 0.98);
    body(0.06 + 0.06 * w, -17.2);
    handAt(i, P.sx + 3.6, P.sy + 4.6, w); setHl(i, lerp(6.6, 3.4, w)); if (!i) hand(1, R1[0], R1[1], 1);
    P.tilt = 0.3 * w;
  } });
  // рука ко лбу (устал, вспоминает)
  R('tHead', { dur: 1.8, fn(o, t, a) {
    H.idle(o, t); belt(o); const i = gi(), w = envA(a, 0.05, 0.3, 0.72, 0.96), [cx, cy] = H.head();
    body(0.06, -17.2);
    handAt(i, cx + 3.4, cy - 0.2, w); setHl(i, lerp(6.6, 2.8, w)); if (!i) hand(1, R1[0], R1[1], 1);
    P.tilt = 0.2 * w;
  } });
  // позвать за собой: рука вперёд и к себе, дважды
  R('tBeckon', { dur: 1.3, fn(o, t, a) {
    H.idle(o, t); belt(o); const i = gi(), w = envA(a, 0.04, 0.2, 0.8, 0.98), k = sin(a * PI * 4);
    body(0.04, -17.2);
    hand(i, 7 + 2.4 * k, 3.6 - 0.6 * k, w); setHl(i, lerp(6.6, 5, w)); if (!i) hand(1, R1[0], R1[1], 1);
  } });
  // помахать ближней рукой (с посохом — посох остаётся в дальней)
  R('tWave', { dur: 1.3, fn(o, t, a) {
    H.idle(o, t); belt(o); const w = envA(a, 0.02, 0.2, 0.8, 0.98);
    body(0.02 + 0.015 * sin(t * 9), -17.2);
    hand(0, 5.5 + 3 * sin(t * 9) * w, -10, w); P.hl0 = lerp(6.6, 7.5, w); hand(1, R1[0], R1[1], 1);
    P.tilt = -0.05 * w;
  } });
  // греет руки: трёт ладони у груди, дует на них (с посохом — одна рука к губам)
  R('tWarm', { dur: 1.6, fn(o, t, a) {
    H.idle(o, t); belt(o); const w = envA(a, 0, 0.2, 0.8, 1), r = envA(a, 0.18, 0.26, 0.74, 0.82), q = sin(t * 17), st = H.look() && H.look().staff;
    body(0.04 + 0.1 * w, -17.2 - 0.35 * w);
    const [cx, cy, ang] = H.head(), mx = cx + Math.cos(ang) * 2.8, my = cy + 1.6;
    if (st) { handAt(0, lerp(P.sx + 6, mx + 0.6, w), lerp(P.sy + 6, my + 0.8, w), w); P.hl0 = lerp(6.6, 1.6, w); P.mouth = 0.5 * r; }
    else { hand(0, 6.2 + 1.4 * q * r, 6.6 + 0.4 * Math.cos(t * 17) * r, w); hand(1, 6.8 - 1.4 * q * r, 6.1, w); P.hl0 = lerp(6.6, 1.8, w); P.hl1 = lerp(6.6, 1.6, w); P.hb = 0.25 * q * r; }
    P.tilt = 0.2 * w;
  } });
  const POSE_OF = { point: 'tPoint', spread: 'tSpread', shrug: 'tShrug', shoulder: 'tShoulder', give: 'tGive', take: 'tTake', chop: 'tChop', heart: 'tHeart', head: 'tHead', beckon: 'tBeckon', wave: 'tWave', warm: 'tWarm' };
  const DUR = k => (k === 'nod' ? 0.9 : k === 'shake' ? 1.0 : AP.DUR[POSE_OF[k]] || 1.4);
  // стоячие «пустые» позы, поверх которых можно играть жест бытовой реплики (работу и ходьбу не трогаем)
  const IDLEISH = { idle: 1, listen: 1, talk: 1, talkHero: 1, lookAround: 1, rubHands: 1, stamp: 1, stretch: 1, adjustPack: 1, blowHands: 1, wipeNose: 1, braceWind: 1, shiver: 1, yawn: 1 };

  // ---------- участники ----------
  const ACT = new Map();   // key (объект в мире) → участник
  function actor(key, role) {
    let A = ACT.get(key);
    if (!A) { A = { key, role, vy: null, e: { brow: 0, knit: 0, smile: 0, open: 1, jaw: 0, yaw: 0 }, et: null, g: null, mouth: 0, nodT: -9, nodA: 0, blinkT: now + 1 + rnd() * 3, face: 0, look: null, out: null, bark: 0 }; ACT.set(key, A); }
    A.role = role || A.role; return A;
  }
  // точка мира (x, y, высота h над снегом) → координаты рига участника (вперёд по взгляду, вверх — минус), с ракурсом vy
  function rigPt(o, face, vy, wx, wy, h) {
    const V = vy >= 0 ? lerp(0.4, 1, vy) : 0.4 + vy * 1.4, S2 = Math.abs(V), K = 1 - 0.82 * S2 * S2, SYv = V * 0.3;
    const fx = (wx - o.x) / (face * K);
    return { x: fx, y: wy - o.y - h - fx * SYv };
  }
  function gesture(A, k, o) { A.g = Object.assign({ k, t0: now, dur: DUR(k) }, o || {}); }

  // ---------- сцена ----------
  let S = null;
  const dlgHidden = () => { const d = document.getElementById('dialog'); return !d || d.hidden; };
  // персонаж в мире, с которым можно поставить сцену: рядом, виден, по ту же сторону стены избы
  function staged(who) {
    const r = typeof NPCS !== 'undefined' && NPCS[who]; if (!r || r.voice || !G || !G.p) return null;
    const st = Npc.state(who); if (!st || (r.states && (r.states[st.state] || {}).hidden)) return null;
    if (st.state === 'dead' || dist(st, G.p) > 240 || insideHut(st.x, st.y) !== insideHut(G.p.x, G.p.y)) return null;
    return st;
  }
  const zTalk = () => Math.min(GFX.zmax, 4, Math.max(1.6, innerHeight / 175));
  // место собеседника: сбоку от героя на дистанции D (по ту сторону, где стоит; занято — с другой)
  function spotFor(n, D) {
    const p = G.p, side0 = Math.sign(n.x - p.x) || -(p.face || 1), dy = clamp(n.y - p.y, -5, 5);
    for (const side of [side0, -side0]) {
      const q = { x: p.x + side * D, y: p.y + dy }, fr = World.freeNear(q.x, q.y, 9);
      if (Math.hypot(fr.x - q.x, fr.y - q.y) < 2.5 && insideHut(q.x, q.y) === insideHut(p.x, p.y)) return q;
    }
    return null;
  }
  function begin(who) {
    const n = staged(who), fixed = n && who === 'vera' && n.state !== 'follow';   // Вера сидит на лежанке — не встаёт
    const sc = { who, p: G.p, npc: n, on: true, out: false, line: null, rep: null, gives: [], give: null, anchor: n ? { x: n.x, y: n.y } : null, fixed, D: 30, t0: now,
      zPrev: GFX.zoomTarget, zSet: null, stay: n && NPCS[who].states && (NPCS[who].states[n.state] || {}).move === 'face' };
    if (n) {
      const Z = zTalk();
      GFX.recenter();
      if (sc.zPrev < Z - 0.15) { GFX.zoomTo(Z); sc.zSet = Z; }
      actor(n, 'npc'); actor(G.p, 'hero');
    }
    return sc;
  }
  // конец сцены: abort — мгновенно на место (тест спрятал окно), иначе камера плавно назад, собеседник отходит на своё место
  function finish(abort) {
    if (!S) return;
    const sc = S; S = null;
    if (sc.zSet != null && Math.abs(GFX.zoomTarget - sc.zSet) < 0.03) { if (abort) GFX.setZoom(sc.zPrev); else GFX.zoomTo(sc.zPrev); }
    GFX.setFocus(null); if (abort && GFX.snapCam) GFX.snapCam();
    if (sc.npc) {
      const A = ACT.get(sc.npc); if (A) { A.g = null; A.out = null; }
      const H0 = ACT.get(G.p); if (H0) { H0.g = null; H0.out = null; }
      if (sc.anchor && sc.stay && !sc.fixed) { if (abort) { sc.npc.x = sc.anchor.x; sc.npc.y = sc.anchor.y; } else back.push({ st: sc.npc, x: sc.anchor.x, y: sc.anchor.y, t: 0 }); }
    }
    if (sc.give && sc.give.pending) sc.give.pending();
  }
  const back = [];   // отходят на своё место после разговора (шагом, в идущей игре)
  function delay() { if (!S) return 0; let d = S.rep ? Math.max(0, S.rep.t0 + S.rep.dur - now) : 0; if (S.npc && now - S.t0 < 0.45) d = Math.max(d, S.t0 + 0.45 - now); return d; }

  // ---------- вход из UI ----------
  function line(node, diff) {
    if (window.TALK_OFF || !node) return 0;
    if (S && S.who !== node.who) finish(false);
    if (!S) S = begin(node.who);
    S.on = true; S.out = false;
    const n = norm(node.t), from = S.npc || G.p;
    const d = delay();
    S.line = { text: clean(node.t), n, tone: node.emo || toneOf(n), gest: node.gest ? [{ k: node.gest, at: 0.1 }] : gestOf(n, from), t0: now + d, done: -1, pos: 0, gi: 0 };
    if (diff && Object.keys(diff).length) give(diff);
    // вещь из текста без изменения инвентаря — только показать (мазь, записка, кружка)
    else if (S.npc && !S.gives.length && at(GIVE_RE, n) >= 0) for (const [re, k] of TXT_ITEM) if (at(re, n) >= 0) { S.gives.push({ from: 'npc', item: k, txt: '' }); break; }
    return d;
  }
  function reply(text) {
    if (window.TALK_OFF || !S) return;
    const t = clean(text); if (!t || t === '…') { S.rep = null; return; }
    const n = norm(t);
    S.rep = { text: t, n, tone: toneOf(n) || (S.line && S.line.tone === 'grief' ? 'grief' : null), gest: gestOf(n, G.p).slice(0, 1), t0: now, dur: clamp(0.9 + t.length * 0.05, 1.1, 3), gi: 0 };
  }
  function end() { if (!S) return; S.on = false; S.out = true; S.outT = now + delay() + 0.2; }
  // инвентарь поменялся в узле: + — собеседник даёт герою, − — герой отдаёт
  function give(diff) {
    if (window.TALK_OFF || !S || !S.npc) return;
    const up = [], dn = [];
    for (const [k, v] of Object.entries(diff)) (v > 0 ? up : dn).push([k, v]);
    const lab = L => L.map(([k, v]) => `${Math.abs(v) > 1 ? Math.abs(v) + ' ' : ''}${ITEMS[k] ? ITEMS[k].i : ':pack:'}`).join(' ');
    if (dn.length) S.gives.push({ from: 'hero', item: HELD[dn.sort((a, b) => a[1] - b[1])[0][0]] || 'bundle', txt: '−' + lab(dn) });
    if (up.length) S.gives.push({ from: 'npc', item: HELD[up.sort((a, b) => b[1] - a[1])[0][0]] || 'bundle', txt: '+' + lab(up) });
  }

  // ---------- кадр ----------
  const VOW = /[аеиоуыэюяaeiouё]/;
  function mouthAt(text, i, t) { const c = text[i] || ' '; return VOW.test(c) ? 0.62 + 0.28 * Math.max(0, sin(t * 21)) : /[ ,.!?…—-]/.test(c) ? 0.05 : 0.3; }
  function stepTo(u, x, y, sp, dt) {
    const dx = x - u.x, dy = y - u.y, d = Math.hypot(dx, dy); if (d < 1.2) return 0;
    const s = Math.min(d, sp * dt); u.x += dx / d * s; u.y += dy / d * s;
    if (typeof World !== 'undefined' && World.solid) World.solid(u, 9, 'n');
    if (Math.abs(dx) > 0.5) u.face = Math.sign(dx);
    return d - s;
  }
  function stage(dt) {
    const sc = S, p = G.p, n = sc.npc;
    if (sc.on && UI.kind !== 'dialog') end();
    if (sc.on && dlgHidden()) { finish(true); return; }
    if (sc.out && (now >= sc.outT || p.moving)) { finish(false); return; }   // ушёл — камера сразу к герою
    if (!n) return;
    const A = actor(n, 'npc'), Hh = actor(p, 'hero');
    // передача: собеседник подходит ближе, оба тянутся к точке встречи рук
    if (!sc.give && sc.gives.length && sc.on && (!sc.line || now >= sc.line.t0 - 0.05)) {
      const q = sc.gives.shift(); sc.give = Object.assign(q, { t0: -1, D: 24 });
    }
    // рука на плечо — ближе
    const shoulderG = [A, Hh].find(X => X.g && X.g.k === 'shoulder');
    const D = sc.give ? 24 : shoulderG ? 17.5 : sc.D;
    let walking = false;
    if (!sc.fixed && sc.on) {
      const q = spotFor(n, D);
      if (q) { const rest = stepTo(n, q.x, q.y, 62, dt); walking = rest > 0.5; }
    }
    A.walking = walking;
    if (sc.give && sc.give.t0 < 0 && !walking) {
      sc.give.t0 = now; const giver = sc.give.from === 'hero' ? Hh : A, taker = giver === A ? Hh : A;
      gesture(giver, 'give', { item: sc.give.item, dur: 2.2 }); gesture(taker, 'take', { item: sc.give.item, dur: 2.2 });
    }
    if (sc.give && sc.give.t0 >= 0) {
      const a = (now - sc.give.t0) / 2.2;
      if (a >= 0.55 && !sc.give.fl) { sc.give.fl = 1; if (sc.give.txt) Fx.floatText(p.x, p.y - 62, sc.give.txt); if (typeof Sound !== 'undefined' && Sound.ok) Sound.ok(); }
      if (a >= 1) sc.give = null;
    }
    // камера: середина пары, лица — чуть выше центра кадра (внизу — плашка ответов)
    GFX.setFocus({ x: (p.x + n.x) / 2, y: (p.y + n.y) / 2 - 26 });
  }
  // кто сейчас говорит и что делает каждый: поза/жест, ракурс, рот, кивки, взгляд, мимика
  function perform(dt) {
    const sc = S, p = G.p;
    const heroA = ACT.get(p), npcA = sc && sc.npc ? ACT.get(sc.npc) : null;
    const tk = UI.talk, L = sc && sc.line;
    let speaker = null, prog = 0;
    if (sc && sc.rep && now >= sc.rep.t0 && now < sc.rep.t0 + sc.rep.dur) { speaker = heroA; prog = (now - sc.rep.t0) / (sc.rep.dur * 0.85); }
    else if (L && now >= L.t0 && tk && tk.len) { prog = tk.n / tk.len; if (prog < 1 || now - (L.done < 0 ? now : L.done) < 0.5) speaker = npcA; if (prog >= 1 && L.done < 0) L.done = now; }
    // жесты реплики — когда речь доходит до слова
    const cur = speaker === heroA && sc && sc.rep ? sc.rep : speaker === npcA ? L : null;
    if (cur && speaker && !speaker.walking) {
      while (cur.gi < cur.gest.length && prog >= cur.gest[cur.gi].at) {
        const q = cur.gest[cur.gi++]; if (speaker.g && (speaker.g.k === 'give' || speaker.g.k === 'take')) continue;
        gesture(speaker, q.k, { pt: q.pt });
        const other = speaker === heroA ? npcA : heroA;
        if (q.k === 'point' && other) other.look = { pt: q.pt, t0: now + 0.3, t1: now + 1.8 };
        if (q.k === 'shoulder' && other) other.nodT = now + 0.9;
      }
    }
    // точки реплики — слушающий кивает
    if (L && speaker === npcA && heroA && tk) { const c = L.text[tk.n - 1]; if (tk.n !== L.pos) { L.pos = tk.n; if (/[.!?…]/.test(c || '') && rnd() < 0.7) heroA.nodT = now; } }
    for (const A of [heroA, npcA]) {
      if (!A || !sc || !sc.npc) continue;
      const other = A === heroA ? npcA : heroA, me = A.key, ot = other && other.key;
      const tone = speaker === A ? (cur && cur.tone) : (speaker && speaker !== A && cur ? mirror(cur.tone) : null);
      A.et = tone ? EMO[tone] : null;
      out(A, me, ot, speaker === A, speaker === A ? cur : null, prog, dt);
    }
  }
  const mirror = t => (t === 'fear' || t === 'grief' || t === 'joy' || t === 'cold' ? t : t === 'anger' ? 'ask' : null);
  // итог для ArtPeople.draw (через setDirector): anim, animT, o {face, vy, target, item}, emo, mouth, nod, blink
  function out(A, me, ot, speaking, cur, prog, dt) {
    const O = { anim: null, animT: 0, o: {}, emo: null, mouth: null, nod: 0, blink: 0 };
    let face = ot ? sgn(ot.x - me.x) : A.face || 1, vy = 0.15;   // вполоборота к собеседнику (¾), лицо к камере чуть повёрнуто
    // жест
    if (A.g) {
      const g = A.g, a = (now - g.t0) / g.dur;
      if (a >= 1) A.g = null;
      else {
        if (g.k === 'nod') A.nodT = A.nodT < g.t0 ? g.t0 : A.nodT;
        else if (g.k === 'shake') { /* голова — ниже */ }
        else {
          O.anim = POSE_OF[g.k]; O.animT = a;
          if (g.k === 'point' && g.pt) {
            const dx = g.pt.x - me.x, dy = g.pt.y - me.y, d = Math.hypot(dx, dy) || 1, sx = dx / d, sy = dy / d;
            if (Math.abs(sx) > 0.3 && sgn(sx) !== face) face = sgn(sx);
            O.o.target = { x: 2 + 12 * Math.max(0.5, Math.abs(sx)), y: -33 + (sy < 0 ? 3.5 * sy : 2 * sy) };
            vy = cl(0.15 + sy * 0.25, 0, 0.5);
          } else if ((g.k === 'give' || g.k === 'take') && ot) {
            const mx = (me.x + ot.x) / 2, my = (me.y + ot.y) / 2;
            O.o.target = rigPt(me, face, A.vy == null ? vy : A.vy, mx, my, 27); O.o.item = g.item;
          } else if (g.k === 'shoulder' && ot) {
            O.o.target = rigPt(me, face, A.vy == null ? vy : A.vy, ot.x - face * 2.6, ot.y, 32.5);
          }
        }
      }
    }
    if (!O.anim && !A.bark) O.anim = speaking ? (A.role === 'hero' ? 'talkHero' : 'tTalk') : 'listen', O.animT = (now % 2) / 2;
    // взгляд туда, куда показали: цель за спиной — развернуться, сбоку — повернуть голову
    let yaw = ot ? 0.16 : 0;   // голова чуть больше корпуса повёрнута к собеседнику
    if (A.look) { if (now > A.look.t1) A.look = null; else if (now > A.look.t0) { const dx = A.look.pt.x - me.x; if (Math.abs(dx) > 40 && sgn(dx) !== face) face = sgn(dx); else yaw = 0.3; } }
    if (A.g && A.g.k === 'shake') { const a = (now - A.g.t0) / A.g.dur; yaw += 0.42 * sin(a * PI * 5) * envA(a, 0, 0.12, 0.8, 1); }
    // кивок: слушает на точках, «да» — дважды
    const nk = now - A.nodT, nodDur = A.g && A.g.k === 'nod' ? 0.9 : 0.45;
    if (nk >= 0 && nk < nodDur) O.nod = 0.2 * Math.abs(sin(nk / 0.45 * PI));
    // рот: говорит — по гласным текста, молчит — закрыт
    if (speaking && cur) { const i = Math.min(cur.text.length - 1, Math.floor(prog * cur.text.length)); O.mouth = prog < 1 ? mouthAt(cur.text, i, now) : 0; A.mouth += (O.mouth - A.mouth) * Math.min(1, dt * 22); O.mouth = A.mouth; }
    else if (!A.bark) { A.mouth *= Math.max(0, 1 - dt * 12); O.mouth = A.mouth < 0.05 ? 0 : A.mouth; }
    // моргание
    if (now > A.blinkT) { A.blinkT = now + 2.2 + rnd() * 3; A.blinkE = now + 0.13; }
    O.blink = now < (A.blinkE || 0) ? 1 : 0;
    // мимика плавно к тону
    const T0 = A.et || {}, e = A.e, k = Math.min(1, dt * 6);
    for (const f of ['brow', 'knit', 'smile', 'jaw']) e[f] += ((T0[f] || 0) - e[f]) * k;
    e.open += ((T0.open == null ? 1 : T0.open) - e.open) * k; e.yaw += (yaw - e.yaw) * Math.min(1, dt * 14);
    const neutral = Math.abs(e.brow) + Math.abs(e.knit) + Math.abs(e.smile) + Math.abs(e.jaw) + Math.abs(e.open - 1) + Math.abs(e.yaw) < 0.02;
    O.emo = neutral ? null : e;
    // ракурс — плавно (без скачка), сторона — через разворот (ArtPeople)
    A.vy = A.vy == null ? vy : A.vy + (vy - A.vy) * Math.min(1, dt * 8);
    O.o.face = face; O.o.vy = A.vy; A.face = face;
    A.out = O;
  }
  // бытовая реплика: жест и мимика по смыслу, рот — пока «говорит»; без камеры
  function bark(o, text, opts = {}) {
    if (window.TALK_OFF || !o || !text || (S && S.npc && (o === S.npc || o === G.p))) return;
    const n = norm(text), A = actor(o, o === (G && G.p) ? 'hero' : 'npc'), life = opts.life || Math.min(5, 2 + text.length * 0.06);
    let to = opts.to || null;   // к кому обращён: человек посёлка — к ближайшему соседу, человек мира — к герою
    if (!to && o !== G.p) { const U = G.col && G.col.units; if (U && U.includes(o)) { let bd = 140 * 140; for (const u of U) if (u !== o && u.type !== 'laika' && !u.hidden) { const d = dist2(u, o); if (d < bd) { bd = d; to = u; } } } else to = G.p; }
    A.bark = { t0: now + 0.15, t1: now + 0.15 + Math.min(life * 0.7, 0.6 + text.length * 0.06), text: clean(text), n, tone: toneOf(n), end: now + life, to, gi: 0,
      gest: o.type === 'laika' ? [] : gestOf(n, o).filter(q => q.k !== 'give').slice(0, 1) };
  }
  function barkTick(dt) {
    for (const [key, A] of ACT) {
      const B = A.bark; if (!B) continue;
      if (now > B.end) { A.bark = 0; if (!S || (key !== S.npc && key !== G.p)) { if (!A.g) ACT.delete(key); else A.out = null; } continue; }
      const O = { anim: null, animT: 0, o: {}, emo: null, mouth: null, nod: 0, blink: 0, idle: true };
      const prog = (now - B.t0) / Math.max(0.3, B.t1 - B.t0);
      if (B.gi < B.gest.length && prog >= B.gest[B.gi].at) { const q = B.gest[B.gi++]; gesture(A, q.k, { pt: q.pt }); }
      if (A.g) { const a = (now - A.g.t0) / A.g.dur; if (a >= 1) A.g = null; else if (POSE_OF[A.g.k]) { O.anim = POSE_OF[A.g.k]; O.animT = a;
        if (A.g.k === 'point' && A.g.pt) { const dx = A.g.pt.x - key.x, dy = A.g.pt.y - key.y, d = Math.hypot(dx, dy) || 1; O.o.face = sgn(dx); O.o.target = { x: 2 + 12 * Math.max(0.5, Math.abs(dx / d)), y: -33 + (dy < 0 ? 3.5 * dy / d : 2 * dy / d) }; } } }
      const nk = now - A.nodT; if (A.g && A.g.k === 'nod' && nk >= 0 && nk < 0.9) O.nod = 0.2 * Math.abs(sin(nk / 0.45 * PI));
      if (A.g && A.g.k === 'nod' && A.nodT < A.g.t0) A.nodT = A.g.t0;
      if (A.g && A.g.k === 'shake') { const a = (now - A.g.t0) / A.g.dur; A.e.yaw = 0.42 * sin(a * PI * 5) * envA(a, 0, 0.12, 0.8, 1); } else A.e.yaw *= 0.8;
      if (prog >= 0 && prog < 1) { const i = Math.floor(prog * B.text.length); A.mouth += (mouthAt(B.text, i, now) - A.mouth) * Math.min(1, dt * 22); } else A.mouth *= Math.max(0, 1 - dt * 12);
      O.mouth = A.mouth > 0.04 ? A.mouth : null;
      const T0 = B.tone ? EMO[B.tone] : {}, e = A.e, k = Math.min(1, dt * 6);
      for (const f of ['brow', 'knit', 'smile', 'jaw']) e[f] += ((T0[f] || 0) - e[f]) * k;
      e.open += ((T0.open == null ? 1 : T0.open) - e.open) * k;
      O.emo = e;
      if (B.to && !O.o.face) O.o.face = sgn(B.to.x - key.x);
      A.out = O;
    }
  }
  let GP = null;   // герой, для которого ведётся учёт (новая игра / загрузка — всё с нуля)
  function tick(dt) {
    if (window.TALK_OFF) { if (S) finish(true); ACT.clear(); return; }
    if (!G) return;
    if (G.p !== GP) { GP = G.p; if (S && S.p !== G.p) finish(true); for (const k of [...ACT.keys()]) if (!S || (k !== S.npc && k !== S.p)) ACT.delete(k); back.length = 0; }
    if (S) stage(dt);
    if (S && S.npc) perform(dt);
    barkTick(dt);
    for (let i = back.length - 1; i >= 0; i--) { const b = back[i]; b.t += dt; if (UI.modal() || !stepTo(b.st, b.x, b.y, 55, dt) || b.t > 4) back.splice(i, 1); }
  }
  // правка позы при рисовании: только у участников; в движении (подходит, идёт) — только лицо и рот
  function direct(o) {
    const A = ACT.get(o.key); if (!A || !A.out) return null;
    const O = A.out;
    if (A.walking || o.anim === 'sleep' || o.anim === 'sit' || o.anim === 'dead' || (o.gait && o.speed > 0.05 && (o.anim === 'walk' || o.anim === 'run' || o.anim === 'carry'))) return { emo: O.emo, mouth: O.mouth, blink: O.blink };
    if (O.idle && !IDLEISH[o.anim]) return { emo: O.emo, mouth: O.mouth, blink: O.blink, nod: O.nod };   // бытовая реплика за работой — только лицо
    return O;
  }
  if (AP.setDirector) AP.setDirector(direct);

  // ---------- раскладка пузырей на экране: без пересечений между собой, с HUD и компасом ----------
  // слоты — прямоугольники экрана (CSS px) на кадр; fit ищет место рядом с головой (вбок, выше); нет места — null (пузырь ждёт очереди)
  const HUD_SEL = ['.tl', '#goals', '.tr', '.bl', '.corner', '#toasts', '#zone', '#prompt', '#cmdbar', '#tip', '.tbtns', '#dialog', '#chapter'];
  let SL = [], hudT = -9, HUD = [];
  function hudRects() {
    if (now - hudT > 0.3 || now < hudT) {
      hudT = now; HUD = [];
      for (const sel of HUD_SEL) for (const e of document.querySelectorAll(sel)) { if (e.closest('[hidden]')) continue; const r = e.getBoundingClientRect(); if (r.width > 2 && r.height > 2) HUD.push({ x0: r.left - 4, y0: r.top - 4, x1: r.right + 4, y1: r.bottom + 4 }); }
    }
    return HUD;
  }
  function slotsReset() { SL = hudRects().slice(); const c = typeof GFX !== 'undefined' && GFX.compassRect; if (c) SL.push(c); }
  const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  // x, y — левый верх пузыря на экране, w×h; возвращает сдвиг {dx, dy} свободного места или null
  function fit(x, y, w, h) {
    const W_ = innerWidth, H_ = innerHeight;
    for (const k of [0, 1, 2, 3]) for (const f of [0, -0.5, 0.5, -1, 1]) {
      const dx = f * (w * 0.6 + 8), dy = -k * (h * 0.55 + 6), b = { x0: x + dx, y0: y + dy, x1: x + dx + w, y1: y + dy + h };
      if (b.x0 < 4 || b.x1 > W_ - 4 || b.y0 < 4 || b.y1 > H_ - 4) continue;
      if (SL.some(r => hit(r, b))) continue;
      SL.push(b); return { dx, dy };
    }
    return null;
  }
  // кого не должны закрывать деревья/постройки (gfx: объекты перед ними полупрозрачны)
  function watchers() {
    const out = [];
    if (S && S.npc && S.on) out.push(S.p, S.npc);
    for (const [k, A] of ACT) if (A.bark && now < A.bark.end) { out.push(k); if (A.bark.to) out.push(A.bark.to); }
    return out;
  }
  // ---------- пузыри реплик (в мире, экранного размера, хвостик к голове) ----------
  const HEAD = 44;   // высота макушки над снегом, px мира (шапка/капюшон)
  function wrap(g, text, maxW) {
    const words = text.split(' '), out = [''];
    for (const w of words) { const s = out[out.length - 1] ? out[out.length - 1] + ' ' + w : w; if (g.measureText(s).width > maxW && out[out.length - 1]) out.push(w); else out[out.length - 1] = s; }
    return out;
  }
  function bubble(g, o, other, text, shown, name, a, k, view) {
    const fs = 13, lh = 16, pad = 8, maxW = Math.min(250, Math.max(140, innerWidth * 0.6));
    g.font = `${fs}px "PT Sans", sans-serif`;
    const lines = wrap(g, text, maxW - pad * 2), w = Math.min(maxW, Math.max(...lines.map(s => g.measureText(s).width)) + pad * 2), h = lines.length * lh + pad * 1.4;
    // якорь: макушка говорящего; пузырь — в сторону от собеседника, в пределах кадра
    const ax = o.x, ay = o.y - HEAD, side = other ? sgn(o.x - other.x) : 1;
    let bx = side * (w / 2 - 26) - w / 2, by = -12 - h;
    // место на экране: не на HUD, не на другом пузыре (k — px мира на px экрана)
    const sc = GFX.worldToScreen(ax, ay), zs = 1 / (k * GFX.zoom), f = fit(sc.x + bx * zs, sc.y + (by - 9) * zs, w * zs, (h + 9) * zs);
    if (!f) return false;
    bx += f.dx / zs; by += f.dy / zs;
    g.save(); g.translate(ax, ay); g.scale(k, k);
    const tx = Math.max(bx + 10, Math.min(bx + w - 10, 0));
    g.globalAlpha = a;
    g.fillStyle = 'rgba(11,18,14,0.28)'; g.beginPath(); g.roundRect(bx + 1.5, by + 2.5, w, h, 6); g.fill();
    g.fillStyle = '#f3eedc'; g.strokeStyle = 'rgba(39,57,74,0.8)'; g.lineWidth = 1.2;
    g.beginPath(); g.roundRect(bx, by, w, h, 6); g.moveTo(tx - 6, by + h); g.lineTo(0, -2); g.lineTo(tx + 6, by + h); g.fill(); g.stroke();
    g.fillRect(tx - 5, by + h - 1.5, 10, 3);   // стереть рамку у основания хвостика
    g.fillStyle = '#27394a'; g.textAlign = 'left'; g.textBaseline = 'middle';
    let left = shown;
    lines.forEach((s, i) => { if (left <= 0) return; const t = left >= s.length ? s : s.slice(0, left); left -= s.length + 1; g.fillText(t, bx + pad, by + pad * 0.7 + lh / 2 + i * lh); });
    if (name) {   // имя говорящего — ярлык над пузырём
      g.font = `400 10px "Russo One", "PT Sans", sans-serif`; const nw = g.measureText(name).width + 10;
      const nx = side > 0 ? bx + w - nw - 6 : bx + 6;
      g.fillStyle = '#27394a'; g.beginPath(); g.roundRect(nx, by - 7, nw, 13, 3); g.fill();
      g.fillStyle = '#ffd27a'; g.fillText(name, nx + 5, by - 0.5);
    }
    g.restore(); return true;
  }
  function draw(g) {
    if (window.TALK_OFF || !S || !S.npc || typeof GFX === 'undefined') return;
    const m = g.getTransform(), z = GFX.zoom, k = (UI.scale || 1) / z;
    const view = { x0: -m.e / m.a, y0: -m.f / m.d, x1: -m.e / m.a + GFX.vw, y1: -m.f / m.d + GFX.vh };
    const p = G.p, n = S.npc, tk = UI.talk;
    if (S.rep && now >= S.rep.t0 && now < S.rep.t0 + S.rep.dur + 0.25) {
      const e = now - S.rep.t0, a = Math.min(1, e * 8, (S.rep.t0 + S.rep.dur + 0.25 - now) * 4);
      bubble(g, p, n, S.rep.text, Math.floor(clamp(e / (S.rep.dur * 0.6), 0, 1) * S.rep.text.length) || 1, null, a, k, view);
    }
    const L = S.line;
    if (L && S.on && now >= L.t0 && tk) {
      const a = Math.min(1, (now - L.t0) * 8), shown = tk.len ? Math.round(tk.n / tk.len * L.text.length) : L.text.length;
      bubble(g, n, p, L.text, Math.max(1, shown), NPCS[S.who] ? (NPCS[S.who].label || NPCS[S.who].n) : '', a, k, view);
    }
  }

  return { line, reply, end, give, tick, draw, bark, delay, fit, slotsReset, watchers, get scene() { return S; }, inWorld: () => !!(S && S.npc), EMO, toneOf, gestOf, ACT };
})();
