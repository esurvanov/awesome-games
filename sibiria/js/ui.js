'use strict';
// Интерфейс: HUD, панели, диалоги, ввод, главный цикл.

// ---------- сохранения: ячейки «Авто» + 1..3 ----------
// Данные ячейки — SaveGame.snapshot() (формат v4: seed + изменения, см. js/savegame.js), рядом маленькая мета для списка.
// «Сибирь 2.0»: сейвы старше v4 не читаются — при запуске стираются, в ячейке остаётся понятная причина
// (один раз показываем и тостом). Старый ключ sibir2-save удаляется так же.
const Saves = (() => {
  const SLOTS = ['auto', '1', '2', '3'];
  const KD = s => 'sibir3-save-' + s, KM = s => 'sibir3-meta-' + s, LEGACY = 'sibir2-save';
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const del = k => { try { localStorage.removeItem(k); } catch (e) {} };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const say = t => { if (typeof UI !== 'undefined') UI.toast(t); };
  const metaOf = g => ({ v: SaveGame.V, W, at: Date.now(), day: g.day, ch: g.chapter, ep: g.col ? g.col.ep : 0, h: ((TUNE.time.startH / 24 + g.time / CYCLE) % 1) * 24 });
  // проверка: { json, g } или { err } с понятной причиной
  function check(json) {
    let g; try { g = JSON.parse(json); } catch (e) { return { err: 'файл повреждён' }; }
    if (!g || typeof g !== 'object' || !g.p || !g.s || !g.inv || typeof g.time !== 'number') return { err: 'не сохранение «Сибири»' };
    const err = SaveGame.problem(g);
    return err ? { err, v: g._v || 2 } : { json, g };
  }
  function write(slot, json, meta) {
    try {
      localStorage.setItem(KD(slot), json);
      localStorage.setItem(KM(slot), JSON.stringify(meta || metaOf(G)));
      return true;
    } catch (e) { say(':close: Нет места в браузере — не сохранено'); return false; }
  }
  function meta(slot) {
    let m = null; try { m = JSON.parse(get(KM(slot)) || 'null'); } catch (e) {}
    const has = !!get(KD(slot));
    if (!has && !(m && m.err)) return null;
    if (!m) m = { v: 0, err: 'нет описания' };
    if (!m.err && m.v > SaveGame.V) m.err = `из новой версии игры (v${m.v})`;
    if (!m.err && m.v < SaveGame.V) m.err = `старое сохранение (v${m.v}) — мир «Сибири 2.0» другой, начните заново`;
    if (!m.err && m.W && m.W !== W) m.err = `мир другого размера (${m.W})`;
    return m;
  }
  function read(slot) { const d = get(KD(slot)); return d ? check(d) : { err: 'пусто' }; }
  function clear(slot) { del(KD(slot)); del(KM(slot)); }
  function latest() {
    let best = null;
    for (const s of SLOTS) { const m = meta(s); if (m && !m.err && (!best || m.at > best.m.at)) best = { s, m }; }
    return best && best.s;
  }
  // обнуление старых сейвов (до v4): данные стираем, в мете — причина; вернуть число стёртых
  let dropped = 0;
  function drop() {
    const reason = v => `старое сохранение (v${v}) стёрто — мир «Сибири 2.0» новый, начните заново`;
    const old = get(LEGACY);
    if (old) { del(LEGACY); if (!get(KD('auto'))) put(KM('auto'), JSON.stringify({ v: 2, err: reason(2) })); dropped++; }
    for (const s of SLOTS) {
      const d = get(KD(s)); if (!d) continue;
      let v = 0; try { v = JSON.parse(d)._v || 2; } catch (e) { continue; } // битый — покажет check
      if (v < SaveGame.V) { del(KD(s)); put(KM(s), JSON.stringify({ v, err: reason(v) })); dropped++; }
    }
  }
  drop();
  return { SLOTS, write, read, meta, clear, latest, check, any: () => SLOTS.some(s => meta(s)), get dropped() { return dropped; } };
})();

// ---------- качество графики: window.QUALITY = 'high' | 'low' ----------
// Режим 'auto' (по умолчанию) переключает на 'low', если игра стабильно ниже 30 кадров/с.
// gfx читает window.QUALITY каждый кадр и/или слушает событие 'sibir-quality'.
const Quality = (() => {
  let mode = 'auto'; try { mode = localStorage.getItem('sibir-quality') || 'auto'; } catch (e) {}
  if (!['auto', 'high', 'low'].includes(mode)) mode = 'auto';
  let autoLow = false, acc = 0, n = 0, work = 0, warm = 3, bad = 0;
  function apply() {
    const q = mode === 'low' || (mode === 'auto' && autoLow) ? 'low' : 'high';
    const was = window.QUALITY; window.QUALITY = q;
    document.documentElement.classList.toggle('lowq', q === 'low');
    if (was !== q) dispatchEvent(new CustomEvent('sibir-quality', { detail: q }));
  }
  function set(m) { mode = m; if (m !== 'auto') autoLow = false; try { localStorage.setItem('sibir-quality', m); } catch (e) {} warm = 3; bad = 0; acc = n = work = 0; apply(); }
  // iv — реальный интервал между кадрами (с), w — время работы кадра (мс)
  function sample(iv, w, playing) {
    if (mode !== 'auto' || autoLow || !playing || document.hidden || iv > 0.5) { acc = n = work = 0; return; }
    if (warm > 0) { warm -= iv; return; }
    acc += iv; work += w; n++;
    if (acc < 3) return;
    const fps = n / acc, ms = work / n; acc = n = work = 0;
    // два окна по 3 с подряд < 30 кадров/с (или кадр дороже 28 мс) → упрощаем
    if (fps < 30 || ms > 28) { if (++bad >= 2) { autoLow = true; apply(); if (typeof UI !== 'undefined') UI.toast(':gfx: Упрощённая графика · пауза — графика'); } }
    else bad = 0;
  }
  apply();
  return { set, sample, get mode() { return mode; }, get level() { return window.QUALITY; } };
})();

const UI = (() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = matchMedia('(pointer: coarse)').matches;
  let kind = null, ctxCache = null, hudT = 0, mapT = 0, goalCache = '', invCache = '', promptCache = '', skillCache = '';
  let dlg = null, typeT = 0, typeN = 0, noteT = 0, dlgT = 0; // dlgT — сколько текст реплики уже на экране целиком (ритм «слушает/говорит»)
  const esc = s => icx(s); // текст → HTML: экранирование + токены :id: → иконки спрайта
  const setText = (el, v) => { v = String(v); if (el.textContent !== v) el.textContent = v; };
  const setHtmlOnce = (el, h) => { if (el._h !== h) { el._h = h; el.innerHTML = h; } };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

  // ---------- один масштаб интерфейса (SPEC-ui §5): --ui и UI.scale для всех слоёв и канвас-оверлеев ----------
  const UI_SCALE = { v: 1 };
  function applyScale() {
    const W_ = innerWidth, H_ = innerHeight;
    const auto = H_ < 520 ? clamp(H_ / 560, 0.7, 1) : W_ < 700 ? clamp(W_ / 400, 0.8, 1) : clamp(Math.min(W_ / 1280, H_ / 800), 0.85, 1.5);
    const v = Math.round(clamp(auto * (Settings.get('ui') || 1), 0.75, 1.8) * 1000) / 1000;
    UI_SCALE.v = v; document.documentElement.style.setProperty('--ui', v);
    document.body.classList.toggle('compact', W_ < 700 || H_ < 520);
    document.body.classList.toggle('narrow', W_ < 700 && H_ >= 520);
    layout();
  }
  // раскладка слотов без наложений (SPEC-ui §6): ширины/отступы колонок TC и BC считаются от TL/TR/BL/BR
  function layout() {
    const u = UI_SCALE.v, W_ = innerWidth, H_ = innerHeight, B = document.body.classList;
    const narrow = B.contains('narrow'), compact = B.contains('compact'), modal = B.contains('modal'), hudOn = !$('hud').hidden;
    const st = document.documentElement.style, set = (k, v) => { if (layout[k] !== v) { layout[k] = v; st.setProperty(k, v); } };
    const R = s => { const e = document.querySelector(s); return e && e.offsetParent !== null ? e.getBoundingClientRect() : null; };
    const inner = W_ / u - 32;
    if (narrow) { set('--tlw', Math.floor(inner * 0.6) + 'px'); set('--trw', Math.floor(inner * 0.4 - 8) + 'px'); }
    else { set('--tlw', '232px'); set('--trw', '220px'); }
    const tl = hudOn && R('.tl'), tr = hudOn && R('.tr');
    // TC: цели → баннер зоны → тосты
    if (narrow) {
      // телефон: TL | TR одной строкой; под TR — звук/пауза; ниже во всю ширину — 5 кнопок BL; ещё ниже — колонка TC
      set('--crt', Math.ceil(((tr ? tr.bottom : 12 * u) + 6) / u) + 'px');
      const crn = R('.corner');
      set('--blt', Math.ceil((Math.max(tl ? tl.bottom : 0, crn ? crn.bottom : 0) + 8) / u) + 'px');
      const bl0 = hudOn && R('.bl');
      const top = modal || !tl ? 12 : (Math.max(tl.bottom, tr ? tr.bottom : 0, crn ? crn.bottom : 0, bl0 ? bl0.bottom : 0) + 8) / u;
      set('--tcx', '50%'); set('--tctx', '-50%'); set('--tct', Math.ceil(top) + 'px'); set('--tcw', inner + 'px');
    } else {
      const blt = hudOn && R('.bl');
      if (compact && tl && blt && blt.top < H_ / 2 && !modal) {
        // телефон лёжа: кнопки BL — справа от TL сверху; колонка TC — под ними, между TL и TR
        set('--tcx', Math.ceil((tl.right + 8) / u) + 'px'); set('--tctx', '0px');
        set('--tct', Math.ceil((blt.bottom + 8) / u) + 'px'); set('--tcw', Math.floor(((tr ? tr.left : W_ - 16) - tl.right - 16) / u) + 'px');
      } else {
        const side = tl ? Math.max(tl.right, tr ? W_ - tr.left : 0) : 16;
        set('--tcx', '50%'); set('--tctx', '-50%');
        set('--tct', '12px'); set('--tcw', Math.floor(Math.max(150, Math.min(320, (W_ - 2 * side - 24) / u))) + 'px');
      }
    }
    // BC: подсказка действия → приказы → подсказка обучения
    const bl = hudOn && R('.bl'), tb = R('.tbtns'), cr = R('.corner'), sk = R('.stick');
    if (compact && tb) {
      // телефон: стек слева от тач-кнопок, от низа экрана (над джойстиком, если он виден)
      set('--bcx', '16px'); set('--bctx', '0px'); set('--bcw', Math.floor((tb.left - 24) / u) + 'px');
      set('--bcb', (sk ? (narrow ? 60 : 20) + 110 + 10 : 16) + 'px'); // над джойстиком в его исходном месте (он сам ездит под пальцем)
    } else if (compact) {
      let lim = H_;
      for (const r of [bl, tb, cr, sk]) if (r && r.top > H_ * 0.45) lim = Math.min(lim, r.top);
      set('--bcx', '50%'); set('--bctx', '-50%');
      set('--bcw', inner + 'px'); set('--bcb', Math.ceil((H_ - lim + 8) / u) + 'px');
    } else {
      set('--bcx', '50%'); set('--bctx', '-50%');
      const side = Math.max(bl ? bl.right : 16, cr ? W_ - cr.left : 16, tb ? W_ - tb.left : 0);
      set('--bcw', Math.floor(Math.max(180, (W_ - 2 * side - 32) / u)) + 'px'); set('--bcb', '16px');
    }
    // модальные окна: сверху — место под один тост
    set('--mtop', Math.round((12 + 48) * u + 8) + 'px');
    // тесный экран: колонки TC (сверху) и BC (снизу) не должны встречаться — прячем по приоритету:
    // подсказка обучения → цели → баннер зоны → старые тосты → тосты
    for (let i = 1; i <= 5; i++) B.remove('sq' + i);
    if (compact && hudOn && !modal) {
      const box = (sel, up) => { let t = Infinity, b = -Infinity; for (const e of document.querySelectorAll(sel)) { if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') continue; const r = e.getBoundingClientRect(); if (r.height < 1 || (up && r.top > H_ / 2)) continue; t = Math.min(t, r.top); b = Math.max(b, r.bottom); } return { t, b }; };
      for (let i = 1; i <= 5; i++) {
        const t1 = box('#tcol > *'), t2 = box('.tl, .tr, .bl, .corner', 1), tc = { b: Math.max(t1.b, t2.b) }, bc = box('#bc > *, .tbtns');
        if (tc.b === -Infinity || bc.t === Infinity || tc.b + 4 <= bc.t) break;
        B.add('sq' + i);
      }
    }
  }
  addEventListener('resize', () => applyScale());

  // ---------- тосты и баннеры ----------
  // вид тоста по первой иконке: отказ/угроза — danger, мир/погода — info, внимание — warn, остальное — ok
  const T_DANGER = /^:(close|wolf|bear|hp|alarm):/, T_INFO = /^:(frost|storm|day|night|radio|heli|antenna|talk|evenk|person|paw):/, T_WARN = /^:(pad|build|sleep|weight|pack|stove|food|timer|epoch):/;
  // одинаковый тост, пока прежний на экране, не дублируется: склеивается в один со счётчиком «×2», срок продлевается
  function toast(txt) {
    const box = $('toasts'); txt = String(txt);
    for (const e of box.children) if (e._txt === txt) {
      e._n = (e._n || 1) + 1; e.innerHTML = icx(txt, 'm') + `<span class="tn"> ×${e._n}</span>`;
      clearTimeout(e._tm); e._tm = setTimeout(() => e.remove(), 2600); if (e !== box.lastChild) box.appendChild(e);
      return;
    }
    while (box.children.length > 2) box.firstChild.remove();
    const kind = T_DANGER.test(txt) ? 'danger' : T_INFO.test(txt) ? 'info' : T_WARN.test(txt) ? 'warn' : 'ok';
    const el = document.createElement('div'); el.className = 'plate toast show ' + kind; el.innerHTML = icx(txt, 'm'); el._txt = txt; box.appendChild(el);
    el._tm = setTimeout(() => el.remove(), 2600);
  }
  function zone(poi) {
    const el = $('zone'); el.innerHTML = `${ic(poi.ic)}${esc(poi.n)}`; el.hidden = false;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(zone.t); zone.t = setTimeout(() => { el.hidden = true; }, 2800);
  }
  function showCard() {
    const el = $('chapter'); el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(chapter.t); chapter.t = setTimeout(() => { el.hidden = true; }, 3400);
  }
  function chapter(i) {
    const c = CHAPTERS[i];
    $('ch-num').innerHTML = `<span class="badge">Глава ${c.num}</span><span class="badge info">${ic('frost', 's')}${String(13 + G.day).padStart(2, '0')}.01.1993 · −${Math.abs(temperature())}°</span>`;
    $('ch-title').innerHTML = ic(c.ic) + esc(c.n);
    $('ch-date').textContent = '';
    $('ch-goals').innerHTML = c.goals.filter(g => !g.alt).map(g => `<span>${ic(g.ic, 's')}${esc(g.t)}</span>`).join('');
    showCard(); Sound.ok2();
  }
  function card(icn, title, text, head) {
    $('ch-num').innerHTML = head ? `<span class="badge">${esc(head)}</span>` : '';
    $('ch-title').innerHTML = (hasIcon(icId(icn)) ? ic(icn) : '') + esc(title); $('ch-date').innerHTML = esc(text); $('ch-goals').innerHTML = '';
    showCard();
  }
  function epoch(i) { const E = EPOCHS[i]; card(':epoch:', ROMAN[i] + ' · ' + E.n, E.d || '', 'Эпоха'); }
  function hint(t) { const el = $('zone'); el.innerHTML = esc(t); el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); clearTimeout(zone.t); zone.t = setTimeout(() => { el.hidden = true; }, 1200); }
  // лицо собеседника: портрет из ArtPeople (тот же риг, что в мире), иначе — иконка
  function face(w) {
    const box = $('dlg-face');
    if (!w.look || typeof ArtPeople === 'undefined') { box.innerHTML = ic(w.i, 'l'); return; }
    const d = Math.min(2, devicePixelRatio || 1), c = document.createElement('canvas'); c.width = c.height = 48 * d;
    const g = c.getContext('2d'); g.scale(d, d);
    try { g.translate(22, 0); g.scale(2.1, 2.1); ArtPeople.draw(g, { x: 0, y: 47, face: 1, t: 0.4, anim: 'idle', look: w.look, tool: 'none', seed: 2 }); } catch (e) {}
    box.innerHTML = ''; box.appendChild(c);
  }
  // ---------- диалоги ----------
  // вещи до/после узла (act, run): что передали из рук в руки — для постановки разговора (js/talk.js)
  const invSnap = () => { const o = {}; for (const k of ITEM_ORDER) o[k] = Inv.cnt(k, true); return o; };
  const invDiff = (a, d = {}) => { const b = invSnap(); for (const k in b) { const v = b[k] - (a[k] || 0); if (v) d[k] = (d[k] || 0) + v; } return d; };
  const TK = typeof Talk !== 'undefined' ? Talk : null;
  function dialog(node, pre) {
    if (!node) return;
    closePanel(true);
    dlg = node; kind = 'dialog'; typeN = 0; typeT = 0; dlgT = 0;
    const inv0 = invSnap();
    if (node.act) Story.act(node.act);
    const w = NPCS[node.who];
    face(w); $('dlg-name').textContent = w.n;
    $('dlg-note').textContent = node.note || ''; $('dlg-note').hidden = !node.note;
    $('dlg-text').textContent = reduced ? node.t : '';
    if (reduced) typeN = node.t.length;
    renderOpts();
    $('dialog').hidden = false;
    // разговор в мире: реплика — пузырём над говорящим (после ответа героя), лица и жесты; окно — компактная плашка ответов
    if (TK) { const d = TK.line(node, invDiff(inv0, Object.assign({}, pre || {}))); if (!reduced) typeT = -d * 45; $('dialog').classList.toggle('inworld', TK.inWorld()); }
  }
  function renderOpts() {
    const opts = dlg.opts || [{ t: 'Дальше' }], done = typeN >= dlg.t.length;
    $('dlg-opts').innerHTML = done ? opts.map((o, i) => `<button class="btn sec opt" data-i="${i}"><kbd>${i + 1}</kbd>${esc(o.t)}</button>`).join('') : '';
  }
  function choose(i) {
    if (kind !== 'dialog') return;
    if (typeN < dlg.t.length) { typeN = dlg.t.length; $('dlg-text').textContent = dlg.t; renderOpts(); return; }
    const opts = dlg.opts || [{ t: 'Дальше' }], o = opts[i]; if (!o) return;
    $('dialog').hidden = true; kind = null; const was = dlg; dlg = null;
    if (TK && (o.t !== 'Дальше' || opts.length > 1)) TK.reply(o.t);   // ответ героя — его пузырь
    if (o.trade) return openTrade(was.who);
    if (o.run) { const inv0 = invSnap(), n = Npc.run(was.who, o.run); return n ? dialog(DIALOG[n], invDiff(inv0)) : undefined; }
    if (o.next) return dialog(DIALOG[o.next]);
    Npc.closed(was.who);
  }
  $('dlg-opts').addEventListener('click', e => { const b = e.target.closest('.opt'); if (b) choose(+b.dataset.i); });
  $('dialog').addEventListener('click', e => { if (!e.target.closest('.opt') && typeN < (dlg ? dlg.t.length : 0)) choose(0); });
  // щелчок/тап по миру в разговоре (js/input.js) — дальше: допечатать реплику / единственный ответ
  function advance() { if (kind === 'dialog' && dlg && (typeN < dlg.t.length || (dlg.opts || [0]).length === 1)) choose(0); }

  // ---------- записки ----------
  function note(n) {
    closePanel(true);
    $('note-ic').innerHTML = ic(n.i || 'log', 's'); $('note-text').innerHTML = esc(n.t);
    $('note').hidden = false; kind = 'note'; noteT = 0;
  }
  $('note').addEventListener('click', () => closePanel());

  // ---------- панели: крафт, изба, ящик, обмен ----------
  let panelTab = 'craft';
  function openCraft(tab) { panelTab = tab || panelTab; kind = 'craft'; renderPanel(); $('panel').hidden = false; }
  function openChest() { kind = 'chest'; renderPanel(); $('panel').hidden = false; }
  let curStash = null;
  function openStash(s) { curStash = s; kind = 'stash'; renderPanel(); $('panel').hidden = false; }
  let tradeWho = 'urk';
  function openTrade(who) { tradeWho = who && NPCS[who] && NPCS[who].trade ? who : 'urk'; kind = 'trade'; renderPanel(); $('panel').hidden = false; }
  // «До утра» (Z): прогноз ночи (Survival.forecast) — мотать или нет
  let skipFc = null, skipMd = 'sleep';
  function openSkip(mode, fc) { if (kind) closePanel(); skipMd = mode; skipFc = fc; kind = 'skip'; renderPanel(); $('panel').hidden = false; }
  // большая карта (A9, js/map.js): пауза, как панель
  function openMap() { if (state !== 'play' || G.p.sleeping) return; if (kind) closePanel(); kind = 'map'; WorldMap.open(); }
  function closePanel(silent) {
    if (kind === 'map') WorldMap.close();
    $('panel').hidden = true; $('note').hidden = true; $('dialog').hidden = true;
    if (!silent || kind !== 'dialog') kind = null;
    dlg = null;
  }
  // ---------- разметка компонентов (SPEC-ui §3) ----------
  const icon = k => k === 'food' ? ':food:' : ITEMS[k].i;
  const bdg = (cls, inner, title) => `<span class="badge ${cls || ''}"${title ? ` title="${icPlain(title)}"` : ''}>${inner}</span>`;
  const costHtml = (cost, wc) => Object.entries(cost).map(([k, v]) => { const have = Inv.cnt(k, wc); return bdg(have >= v ? '' : 'miss', ic(icon(k), 's') + (have >= v ? v : `${Math.min(have, v)}/${v}`), k === 'food' ? 'еда' : ITEMS[k].n); }).join('');
  const ST_IC = { fire: 'fire', stove: 'stove', bench: 'craft' }, ST_N = { fire: 'у огня', stove: 'у печи', bench: 'верстак' };
  const setHtml = setHtmlOnce;
  const row = (st, i, name, sub, badges, act) => `<div class="row ${st}"><span class="ri">${ic(i)}</span><span class="rn">${esc(name)}<small>${esc(sub || '')}</small></span><span class="badges">${badges || ''}</span>${act}</div>`;
  const mkBtn = (data, ok, label) => `<button class="btn pri" ${data} ${ok ? '' : 'disabled'}>${label}</button>`;
  const doneB = (t = 'готово') => `<span class="badge ok lamp">${t}</span>`;
  const secs = t => bdg('', ic('timer', 's') + t + ' с');
  function renderPanel() {
    const body = $('panel-body'), head = { set innerHTML(h) { setHtml($('panel-head'), h); } };
    if (kind === 'craft') {
      const tabs = [['craft', 'craft', 'Мастерская'], ['hut', 'hut', 'Изба'], ['build', 'build', 'Стройка'], ['people', 'people', 'Люди'], ['epoch', 'epoch', 'Эпоха']];
      if (Colony.doneCount('market')) tabs.push(['market', 'trade', 'Торг']);
      head.innerHTML = `<div class="tabs">${tabs.map(([k, i, t]) => `<button class="tab ${panelTab === k ? 'on' : ''}" data-tab="${k}">${ic(i, 's')}${t}</button>`).join('')}</div>`;
      let html = '';
      if (panelTab === 'craft') {
        if (G.flags.radioBuilt && G.p.inside && dist2(G.p, SPOT.bench) < 70 * 70) html += `<div class="row sel"><span class="ri">${ic('radio')}</span><span class="rn">Выйти на связь<small>07:30–09:00 · 19:30–21:00</small></span><span></span><button class="btn pri" data-radio="1">${ic('play', 's')}Связь</button></div>`;
        for (const r of RECIPES) {
          const st = Actions.recipeState(r), off = st !== 'ok' && st !== 'owned';
          const b = bdg(Actions.stationOk(r.at) ? '' : 'miss', ic(ST_IC[r.at], 's'), ST_N[r.at]) + costHtml(r.in, G.p.inside) + (r.radio ? bdg(G.charge >= 100 ? '' : 'miss', ic('battery', 's') + Math.floor(G.charge) + '%') : '');
          html += row(st === 'owned' ? 'done' : off ? 'is-off' : '', st === 'owned' ? 'ok' : r.i, r.n, r.d, st === 'owned' ? '' : b, st === 'owned' ? doneB() : mkBtn(`data-r="${r.id}"`, st === 'ok', 'Сделать'));
        }
      } else if (panelTab === 'build') {
        html += `<p class="hint">${ic('epoch', 's')}Эпоха ${ROMAN[G.col.ep]} · ${esc(EPOCHS[G.col.ep].n)} · лабаз + рюкзак</p>`;
        for (const [id, B] of Object.entries(BUILDS)) {
          const lockEp = B.ep > G.col.ep, ok = !lockEp && Inv.canPay(B.cost, true), n = Colony.doneCount(id);
          const b = (lockEp ? bdg('miss', ic('epoch', 's') + ROMAN[B.ep], 'эпоха ' + EPOCHS[B.ep].n) : costHtml(B.cost, true)) + secs(B.t);
          html += row(ok ? '' : 'is-off', B.i, B.n + (n ? ` ×${n}` : ''), B.d, b, mkBtn(`data-place="${id}"`, ok, 'Построить'));
        }
      } else if (panelTab === 'people') {
        const q = G.col.queue;
        html += `<p class="hint">${ic('people', 's')}${Colony.pop()}/${Colony.popCap()} · ${ic('food', 's')}1 за ${gameDur(TUNE.colony.eatEvery)} на каждого · найм у избы</p>`;
        if (q.length) html += `<div class="chain">${q.map((x, i) => `<span class="on" title="${UNITS[x.type].n}">${ic(UNITS[x.type].i)}${i === 0 ? `<span class="badge">${Math.ceil(x.t)} с</span>` : ''}</span>`).join('')}</div>`;
        for (const [id, U] of Object.entries(UNITS)) {
          const st = Colony.unitState(id), n = G.col.units.filter(u => u.type === id && !u.pet).length;
          const why = { ep: bdg('miss', ic('epoch', 's') + ROMAN[U.ep]), pop: bdg('miss', ic('balok', 's') + 'нет мест'), queue: bdg('miss', ic('timer', 's') + 'очередь'), station: bdg('miss', ic('hut', 's') + 'у избы') }[st] || '';
          html += row(st === 'ok' ? '' : 'is-off', U.i, U.n + (n ? ` ×${n}` : ''), `${U.d} · :hp:${U.hp}`, why + costHtml(U.cost, true), mkBtn(`data-hire="${id}"`, st === 'ok', 'Нанять'));
        }
      } else if (panelTab === 'epoch') {
        const C = G.col, E = EPOCHS[C.ep + 1];
        html += `<div class="chain">${EPOCHS.map((e, i) => `<span class="${i <= C.ep ? 'on' : ''}" title="${e.n}">${ic('epoch', 's')}${ROMAN[i]}</span>`).join('<i></i>')}</div>`;
        if (C.epT > 0) html += `<p class="hint">${ic('timer', 's')}${ROMAN[C.ep + 1]} · ${esc(E.n)}: ${Math.ceil(C.epT)} с</p>`;
        else if (E) {
          const st = Colony.epochState();
          const req = E.any ? E.any.map(t => bdg(Colony.doneCount(t) ? '' : 'miss', ic(BUILDS[t].i, 's'), BUILDS[t].n)).join('') + bdg('', 'любые ' + E.need) : E.all.map(t => bdg(Colony.doneCount(t) ? '' : 'miss', ic(BUILDS[t].i, 's'), BUILDS[t].n)).join('');
          html += row(st === 'ok' ? 'sel' : 'is-off', 'epoch', ROMAN[C.ep + 1] + ' · ' + E.n, E.d, req + costHtml(E.cost, true) + secs(E.t), mkBtn('data-epoch="1"', st === 'ok', 'Начать'));
        }
        html += `<p class="hint">${ic('forge', 's')}Кузня${C.research ? ` · ${ic(TECHS[C.research.id].i, 's')}${Math.ceil(C.research.t)} с` : ''}</p>`;
        for (const [id, T] of Object.entries(TECHS)) {
          const st = Colony.techState(id);
          const why = { ep: bdg('miss', ic('epoch', 's') + ROMAN[T.ep]), forge: bdg('miss', ic('forge', 's') + 'нужна кузня'), busy: bdg('miss', ic('timer', 's')) }[st] || '';
          html += row(st === 'owned' ? 'done' : st === 'ok' ? '' : 'is-off', st === 'owned' ? 'ok' : T.i, T.n, T.d, st === 'owned' ? '' : why + costHtml(T.cost, true), st === 'owned' ? doneB('изучено') : mkBtn(`data-tech="${id}"`, st === 'ok', 'Изучить'));
        }
      } else if (panelTab === 'market') {
        const near = Colony.nearMarket();
        html += `<p class="hint">${ic('coins', 's')}${G.col.rub} ₽ · инфляция +5% в сутки${near ? '' : ` · ${ic('market', 's')}подойди к фактории`}</p>`;
        html += `<div class="chead"><span></span><span>${ic('labaz', 's')}</span><span>продать · купить</span><span>₽</span></div>`;
        for (const k of [...new Set([...MARKET_SELL, ...MARKET_BUY])]) {
          const canS = MARKET_SELL.includes(k), canB = MARKET_BUY.includes(k);
          html += `<div class="crow"><span class="ri" title="${ITEMS[k].n}">${ic(ITEMS[k].i)}</span><b>${Inv.cnt(k, true)}</b>
            <span class="arr">${canS ? `<button class="btn sec" data-sell="${k}" ${near && Inv.cnt(k, true) ? '' : 'disabled'}>Продать +${Colony.sellPrice(k)}</button>` : ''}${canB ? `<button class="btn sec" data-buy="${k}" ${near && G.col.rub >= Colony.buyPrice(k) ? '' : 'disabled'}>Купить −${Colony.buyPrice(k)}</button>` : ''}</span>
            <b>${Math.round(G.col.prices[k])}</b></div>`;
        }
      } else {
        html += `<div class="chain">${HUT_UPG.map(u => `<span class="${G.hut[u.id] ? 'on' : ''}" title="${u.n}">${ic(u.i)}</span>`).join('<i></i>')}</div>`;
        for (const u of HUT_UPG) {
          const st = Actions.hutUpgState(u);
          html += row(st === 'owned' ? 'done' : st === 'ok' ? '' : 'is-off', st === 'owned' ? 'ok' : u.i, u.n, u.d, st === 'owned' ? '' : st === 'need' ? bdg('miss', ic('wall', 's') + 'сначала щели') : costHtml(Actions.hutLeft(u), true) + (G.hut.prog && G.hut.prog[u.id] ? bdg('', Math.round(G.hut.prog[u.id] * 100) + '%') : ''), st === 'owned' ? doneB() : mkBtn(`data-u="${u.id}"`, st === 'ok', G.hut.prog && G.hut.prog[u.id] ? 'Доделать' : 'Построить'));
        }
        if (!World.nearHut()) html += `<p class="hint">${ic('hut', 's')}Только у избы</p>`;
      }
      setHtml(body, html);
    } else if (kind === 'chest') {
      head.innerHTML = `<span class="ph">${ic('labaz', 's')}Лабаз</span><button class="btn sec" data-all="put" style="margin-left:auto">Положить всё</button>`;
      const ids = ITEM_ORDER.filter(k => (G.inv[k] || 0) + (G.chest[k] || 0) > 0);
      setHtml(body, ids.length ? `<div class="chead"><span></span><span>${ic('pack', 's')}</span><span></span><span>${ic('labaz', 's')}</span></div>` + ids.map(k => `<div class="crow"><span class="ri" title="${ITEMS[k].n}">${ic(ITEMS[k].i)}</span>
        <b>${G.inv[k] || 0}</b>
        <span class="arr"><button class="btn sec" data-put="${k}" ${G.inv[k] ? '' : 'disabled'}>Положить</button><button class="btn sec" data-take="${k}" ${G.chest[k] ? '' : 'disabled'}>Взять</button></span>
        <b>${G.chest[k] || 0}</b></div>`).join('') : '<p class="hint">Пусто</p>');
    } else if (kind === 'stash') {
      const s = curStash || { inv: {} };
      head.innerHTML = `<span class="ph">${ic('pack', 's')}Тайник</span><button class="btn sec" data-all="stashput" style="margin-left:auto">Положить всё</button>`;
      const ids = ITEM_ORDER.filter(k => (G.inv[k] || 0) + (s.inv[k] || 0) > 0);
      setHtml(body, ids.length ? `<div class="chead"><span></span><span>${ic('pack', 's')}</span><span></span><span>${ic('pack', 's')}</span></div>` + ids.map(k => `<div class="crow"><span class="ri" title="${ITEMS[k].n}">${ic(ITEMS[k].i)}</span>
        <b>${G.inv[k] || 0}</b>
        <span class="arr"><button class="btn sec" data-sput="${k}" ${G.inv[k] ? '' : 'disabled'}>Положить</button><button class="btn sec" data-stake="${k}" ${s.inv[k] ? '' : 'disabled'}>Взять</button></span>
        <b>${s.inv[k] || 0}</b></div>`).join('') : '<p class="hint">Пусто</p>');
    } else if (kind === 'skip') {
      // прогноз «До утра»: сейчас → к утру по каждой шкале; красное — не хватит (час, когда кончится)
      const f = skipFc, sl = skipMd === 'sleep', hm = t => { const h = hourOf(t); return String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor(h % 1 * 60)).padStart(2, '0'); };
      const stop = f.deadAt != null ? f.deadAt : f.wakeAt;
      head.innerHTML = `<span class="ph">${ic(sl ? 'sleep' : 'night', 's')}${sl ? 'Сон до утра' : 'Переждать ночь'}</span><span class="badge info" style="margin-left:auto">${ic('timer', 's')}${hm(G.time)} → ${hm(stop != null ? stop : f.to)}</span>`;
      const ar = (a, b, bad, at) => bdg(bad ? 'miss' : 'ok', `${Math.round(a)} → ${Math.round(b)}${at != null ? ` · ${hm(at)}` : ''}`);
      const fuelN = G.p.inside ? ['stove', 'Печь'] : ['fire', 'Огонь'], hadFuel = G.p.inside ? G.hut.fuel > 0 : !!Fire.heatAt(G.p, 0);
      const fuelB = !hadFuel ? bdg('miss', ic('close', 's') + 'нет') : f.fuelAt != null ? bdg('miss', `до ${hm(f.fuelAt)}`) : bdg('ok', ic('ok', 's') + 'до утра');
      const verdict = f.deadAt != null ? `<div class="row is-off"><span class="ri">${ic('close')}</span><span class="rn">${f.cause === 'food' ? 'Голод' : 'Холод'}<small>смерть</small></span>${bdg('miss', ic('timer', 's') + hm(f.deadAt))}<span></span></div>`
        : f.wakeAt != null ? `<div class="row"><span class="ri">${ic('frost')}</span><span class="rn">Печь погаснет<small>разбудит</small></span>${bdg('miss', ic('timer', 's') + hm(f.wakeAt))}<span></span></div>`
        : `<div class="row done"><span class="ri">${ic('ok')}</span><span class="rn">Доживёшь<small>${sl ? 'сон · голод слабее' : 'без сна'}</small></span>${bdg('ok', ic('day', 's') + hm(f.to))}<span></span></div>`;
      setHtml(body, row('', 'food', 'Еда', '', ar(G.s.food, f.food, f.hungryAt != null, f.hungryAt), '')
        + row('', 'warm', 'Тепло', '', ar(G.s.warm, f.warm, f.coldAt != null, f.coldAt), '')
        + row('', fuelN[0], fuelN[1], '', fuelB, '')
        + row('', 'hp', 'Здоровье', '', ar(G.s.hp, f.hp, f.hp < G.s.hp - 0.5 || f.deadAt != null), '')
        + row('', 'tire', 'Силы', '', ar(100 - (G.s.tire || 0), 100 - f.tire, 100 - f.tire < TUNE.tire.low), '')
        + verdict
        + `<div class="hint"><button class="btn pri" data-skip="go">${ic('timer', 's')}До утра${isTouch ? '' : '<kbd>Z</kbd>'}</button><button class="btn sec" data-close="1">${ic('close', 's')}Отмена</button></div>`);
    } else if (kind === 'trade') {
      // торг с персонажем tradeWho: валюта — его trade.pay (цены единицы — trade.val), остаток — в его состоянии
      const who = tradeWho, R = NPCS[who], T = R.trade, st = Npc.state(who), cur = T.cur || 'pelt', have = Npc.furTotal(who);
      const extra = who === 'urk' ? ` · ${ic('evenk', 's')}${G.urk.respect}/3` : '';
      head.innerHTML = `<span class="ph">${ic('trade', 's')}Торг · ${esc(R.n)}</span><span class="fur">${ic(cur, 's')}${have}${extra}</span>`;
      const hint = T.pay.map(k => `${ic(ITEMS[k].i, 's')}${Npc.unit(who, k)}`).join(' · ') + ' ' + ic(cur, 's');
      setHtml(body, `<p class="hint">${hint}</p>` + T.goods.map(t => {
        const pr = Npc.price(t, who), left = st.stock[t.id], owned = t.gear && G.gear[t.gear], can = left > 0 && !owned && have >= pr;
        const done = owned || left <= 0;
        return row(done ? 'done' : can ? '' : 'is-off', done ? 'ok' : t.i, t.n, t.d || (t.gear ? GEAR[t.gear].d : 'осталось ' + left), done ? '' : bdg(have >= pr ? '' : 'miss', ic(cur, 's') + pr), done ? doneB(owned ? 'есть' : 'нет') : mkBtn(`data-t="${t.id}"`, can, 'Купить'));
      }).join(''));
    }
  }
  $('panel').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.tab) { panelTab = b.dataset.tab; }
    else if (b.dataset.r) { if (Actions.craft(RECIPES.find(r => r.id === b.dataset.r))) { closePanel(); hud(true); return; } } // работа — в мире: окно закрывается, прогресс над героем
    else if (b.dataset.u) { if (Actions.buildHut(HUT_UPG.find(u => u.id === b.dataset.u))) { closePanel(); hud(true); return; } } // изба — тоже работа в мире: идёт к месту, часть растёт по ходу
    else if (b.dataset.t) Npc.buy(NPCS[tradeWho].trade.goods.find(t => t.id === b.dataset.t), tradeWho);
    else if (b.dataset.radio) { closePanel(); return Actions.radioSession(); }
    else if (b.dataset.place) { closePanel(); Colony.startPlace(b.dataset.place); return; }
    else if (b.dataset.hire) Colony.hire(b.dataset.hire);
    else if (b.dataset.epoch) Colony.advance();
    else if (b.dataset.tech) Colony.research(b.dataset.tech);
    else if (b.dataset.sell) Colony.sell(b.dataset.sell);
    else if (b.dataset.buy) Colony.buy(b.dataset.buy);
    else if (b.dataset.put) { const k = b.dataset.put; if (G.inv[k] > 0) { G.inv[k]--; G.chest[k] = (G.chest[k] || 0) + 1; stowGesture(true, k); } }
    else if (b.dataset.take) { const k = b.dataset.take; if (G.chest[k] > 0) { G.chest[k]--; Inv.add(k); stowGesture(false, k); } }
    else if (b.dataset.sput && curStash) { const k = b.dataset.sput; if (G.inv[k] > 0) { G.inv[k]--; curStash.inv[k] = (curStash.inv[k] || 0) + 1; stowGesture(true, k); } }
    else if (b.dataset.stake && curStash) { const k = b.dataset.stake; if (curStash.inv[k] > 0) { curStash.inv[k]--; Inv.add(k); stowGesture(false, k); } }
    else if (b.dataset.all === 'stashput' && curStash) { for (const k in G.inv) if (G.inv[k] > 0) { curStash.inv[k] = (curStash.inv[k] || 0) + G.inv[k]; G.inv[k] = 0; } }
    else if (b.dataset.all) { for (const k in G.inv) if (G.inv[k] > 0) { G.chest[k] = (G.chest[k] || 0) + G.inv[k]; G.inv[k] = 0; } }
    else if (b.dataset.close) return closePanel();
    else if (b.dataset.skip) { closePanel(); return Actions.skipStart(); }
    renderPanel(); hud(true);
  });
  $('panel-close').addEventListener('click', () => closePanel());
  // положить/взять: герой наклоняется к ящику/тайнику (крышка открыта, пока окно открыто), вещь — в руке
  function stowGesture(put, k) {
    const at = kind === 'chest' ? SPOT.chest : curStash; if (!at || typeof Hero === 'undefined') return;
    if (put) { Hero.play('place', { react: 1, tg: at, th: kind === 'chest' ? -14 : -6 }); } else Hero.play('pickUp', { react: 1, tg: at, th: kind === 'chest' ? -14 : -6 });
    if (typeof Interact !== 'undefined') Interact.emit('open', { who: 'p', obj: kind === 'chest' ? 'crate' : 'stash', target: at, x: at.x, y: at.y });
    Fx.floatText(at.x, at.y - 30, (put ? '→ ' : '+') + (ITEMS[k] ? ITEMS[k].i : ''));
  }

  // ---------- подсказки первых минут: каждая один раз, по одной, можно выключить ----------
  const tips = (() => {
    const T = isTouch;
    const LIST = [
      ['move', 'skis', T ? 'Джойстик слева — идти' : 'WASD / стрелки — идти', () => G.time > 3],
      ['act', 'axe', T ? ':axe: — действие: рубить, брать, говорить' : 'E — действие рядом: рубить, брать, говорить', () => !!ctxCache && ctxCache.k !== 'inspect'],
      ['fire', 'fire', T ? ':fire: — костёр из :wood:3, греет' : 'F — костёр из :wood:3, греет', () => !G.p.inside && G.s.warm < 70 && Inv.cnt('wood', false) >= 3],
      ['cold', 'frost', 'Мёрзнешь — в избу или к огню', () => G.s.warm < 45 && !G.p.inside && !Fire.near(200)],
      ['tired', 'tire', ':sleep: Устал — к огню или спать', () => (G.s.tire || 0) > TUNE.tire.tired && !G.p.sleeping],
      ['eat', 'food', T ? ':food: — поесть · у огня сытнее' : 'Q — поесть · у огня сытнее', () => G.s.food < 55 && FOOD_ORDER.some(k => Inv.cnt(k, G.p.inside) > 0)],
      ['stove', 'stove', 'Печь: E у печи · :wood: из рук или лабаза', () => G.p.inside && G.hut.fuel <= 0],
      ['night', 'night', 'После 19:00 — спать у печи (E у кровати)', () => { const h = hourOf(); return h >= 17.5 && h < 19.5; }],
      ['craft', 'craft', T ? ':craft: — мастерская, изба, посёлок' : 'C — мастерская, изба, посёлок', () => G.time > 150 && G.p.inside],
      ['build', 'build', T ? ':craft: · :build: — стройка посёлка' : 'B — стройка посёлка', () => G.col.units.some(u => u.type === 'bich') || Inv.cnt('wood', true) >= 10],
      ['select', 'people', T ? 'Тап по человеку — выбрать · тап по месту — приказ' : 'Рамка ЛКМ — выбрать людей · ПКМ — приказ', () => G.col.units.some(u => !u.pet && !u.hidden)],
      ['zoom', 'cam', T ? 'Два пальца — масштаб и обзор' : 'Колесо — масштаб · СКМ / край экрана — обзор · 0 — к герою', () => G.col.units.filter(u => !u.pet).length >= 2 || G.time > 400],
    ];
    let seen = {}; try { seen = JSON.parse(localStorage.getItem('sibir-tips') || '{}') || {}; } catch (e) {}
    let cur = null, showT = 0, gapT = 6, chkT = 0;
    const save = () => { try { localStorage.setItem('sibir-tips', JSON.stringify(seen)); } catch (e) {} };
    function hide() { cur = null; $('tip').hidden = true; gapT = 8; }
    function did(k) {
      if (!k || seen[k]) return;
      seen[k] = 1; save();
      if (cur === k) hide();
    }
    function tick(dt) {
      if (!Settings.get('tips')) { if (cur) hide(); return; }
      if (cur) { showT -= dt; if (showT <= 0 || kind) { seen[cur] = 1; save(); hide(); } return; }
      if (kind || G.p.sleeping) return;
      gapT -= dt; chkT -= dt; if (gapT > 0 || chkT > 0) return; chkT = 0.5;
      for (const [k, i, t, when] of LIST) {
        if (seen[k]) continue;
        let ok = false; try { ok = when(); } catch (e) {}
        if (!ok) continue;
        if (k === 'move' && G.p.moving) { did('move'); continue; }
        cur = k; showT = 9;
        $('tip-i').innerHTML = ic(i); $('tip-t').innerHTML = esc(t);
        const el = $('tip'); el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
        return;
      }
    }
    $('tip-x').addEventListener('click', () => { if (cur) { seen[cur] = 1; save(); } hide(); });
    $('tip-off').addEventListener('click', () => { Settings.set('tips', 0); hide(); toast(':tips: Подсказки выключены · пауза — настройки'); });
    return { did, tick, hide, reset() { seen = {}; save(); }, get cur() { return cur; } };
  })();

  // ---------- HUD ----------
  const els = { warm: $('b-warm'), food: $('b-food'), hp: $('b-hp'), tire: $('b-tire') };
  function bar(el, v, max = 100) {
    el.querySelector('i').style.width = v + '%';
    const cap = el.querySelector('u'); if (cap) cap.style.width = (100 - max) + '%';
    setText(el.querySelector('b'), Math.ceil(v)); el.classList.toggle('low', v < 25);
  }
  const chipI = (id, v, title, cls) => `<span${cls ? ` class="${cls}"` : ''} title="${title}">${ic(id, 's')}${v}</span>`;
  function hud(force) {
    const s = G.s;
    bar(els.warm, s.warm, Hero.maxWarm()); bar(els.food, s.food); bar(els.hp, Math.max(0, s.hp));
    // силы = 100 − усталость: пульс ниже TUNE.tire.low, синие края ниже edge; края темнеют, когда клонит в сон на морозе
    const TI = TUNE.tire, pw = 100 - (s.tire || 0), dz = Survival.dozeFx(), vg = $('vig');
    bar(els.tire, pw); els.tire.classList.toggle('pulse', pw < TI.low);
    const edge = pw < TI.edge && !G.p.inside && !G.p.sleeping ? (TI.edge - pw) / TI.edge : 0;
    vg.style.setProperty('--d', (dz * 0.92).toFixed(2)); vg.style.setProperty('--b', (edge * 0.55).toFixed(2)); vg.classList.toggle('on', dz > 0 || edge > 0);
    setHtmlOnce($('frost'), s.frost ? ic('frost', 's').repeat(s.frost) : '');
    // инвентарь
    const inv = ITEM_ORDER.filter(k => G.inv[k] > 0).map(k => chipI(ITEMS[k].i, G.inv[k], ITEMS[k].n)).join('');
    const kg = Inv.weight(), cap = Inv.capKg();
    const invHtml = (inv || '<span class="dim">пусто</span>') + chipI('weight', `${kg}/${cap}`, 'Вес, кг', 'kg' + (kg > cap ? ' over' : ''));
    if (invHtml !== invCache || force) { invCache = invHtml; $('inv').innerHTML = invHtml; }
    // посёлок
    const C = G.col, st = k => G.chest[k] || 0;
    const colHtml = `<span title="Эпоха">${ic('epoch', 's')}${ROMAN[C.ep]}${C.epT > 0 ? `<small>${Math.ceil(C.epT)} с</small>` : ''}</span>` + chipI('people', `${Colony.pop()}/${Colony.popCap()}`, 'Люди')
      + chipI('wood', st('wood'), 'Лабаз: дрова') + chipI('food', Inv.cnt('food', true) - Inv.cnt('food', false), 'Лабаз: еда') + chipI('scrap', st('scrap'), 'Лабаз: железо')
      + chipI('coins', C.rub, 'Рубли') + chipI('sevek', `${G.amulets}/12`, 'Сэвэки') + (C.alarm ? `<span class="alarm">${ic('alarm', 's')}</span>` : '');
    if (colHtml !== $('colony').dataset.c) { $('colony').dataset.c = colHtml; $('colony').innerHTML = colHtml; }
    const sel = Colony.selected();
    let cb = '';
    const cbtn = (cmd, id, title, extra = '') => `<button class="btn sec ico mini" data-cmd="${cmd}" title="${title}"${extra}>${ic(id)}</button>`;
    if (C.ghost) cb = `<span class="cbt">${ic(BUILDS[C.ghost.type].i)}${esc(BUILDS[C.ghost.type].n)}</span>${isTouch ? `<button class="btn pri mini" data-cmd="place">${ic('ok', 's')}Построить</button>` : '<span class="dim">ЛКМ — построить · ПКМ — отмена</span>'}${cbtn('cancel', 'close', 'Отмена')}`;
    else if (sel.length && (!isTouch || orderMode)) {
      const groups = {}; for (const u of sel) groups[u.type] = (groups[u.type] || 0) + 1;
      cb = `<span class="cbt">${Object.entries(groups).map(([t, n]) => ic(UNITS[t].i, 's') + (n > 1 ? '×' + n : '')).join(' ')}</span>`
        + cbtn('chop', 'axe', 'Рубить') + cbtn('hunt', 'rifle', 'Охота') + cbtn('guard', 'tower', 'Охрана') + cbtn('home', 'hut', 'Домой') + cbtn('stop', 'close', 'Стоп')
        + cbtn('focus', 'pin', 'К выделенным (G)') + grpChips() + cbtn('desel', 'back', 'Снять выделение')
        + (isTouch ? '' : `<span class="dim">ПКМ — приказ · Ctrl+1–3 — группа</span>`);
    } else if (isTouch && orderMode) cb = `<span class="cbt">${ic('people')}</span><span class="dim">тапни людей</span>${grpChips()}<button class="btn sec mini" data-cmd="order">${ic('back', 's')}Герой</button>`;
    if (cb !== $('cmdbar').dataset.c) { $('cmdbar').dataset.c = cb; $('cmdbar').innerHTML = cb; $('cmdbar').hidden = !cb; }
    // часы, погода; облик день/ночь для токенов
    const h = hourOf(), d = daylight(h);
    const tm = d > 0.5 ? 'day' : 'night'; if (document.documentElement.dataset.time !== tm) document.documentElement.dataset.time = tm;
    const hh = String(Math.floor(h)).padStart(2, '0'), mm = String(Math.floor(h % 1 * 60)).padStart(2, '0');
    setHtmlOnce($('clock'), `${ic(tm, 's')}${G.day} · ${hh}:${mm}`);
    setHtmlOnce($('temp'), `${ic('frost', 's')}−${Math.abs(temperature())}°`);
    $('storm').hidden = !stormOn();
    $('clock').classList.toggle('warn', h > 16 && h < 18 && !G.p.inside && Math.hypot(G.p.x - HUT.x, G.p.y - HUT.y) > 700);
    // рация
    const parts = PARTS.map(k => {
      const got = G.flags.radioBuilt || (k === 'quartz' ? G.flags.quartz && Inv.has('quartz', true) || G.flags.radioBuilt : Inv.has(k, true));
      return `<span title="${ITEMS[k].n}">${ic(ITEMS[k].i, got ? 'on' : '')}</span>`;
    }).join('') + `<span class="ch">${G.flags.radioBuilt ? ic('radio', 's on') : Math.floor(G.charge) + '%'}</span>`;
    if (parts !== $('parts').dataset.c) { $('parts').dataset.c = parts; $('parts').innerHTML = parts; }
    // цели
    const ch = CHAPTERS[G.chapter];
    // + взятые задания людей (QUESTS[*].hud) — отдельными строками .qg под целями главы (не больше трёх)
    const qs = Quests.active().filter(id => QUESTS[id].hud).slice(0, 3).map(id => `<div class="qg">${ic(QUESTS[id].hud[0])}${esc(QUESTS[id].hud[1])}</div>`).join('');
    const gh = `<div class="plate-h">${ic(ch.ic, 's')}${ch.num} · ${esc(ch.n)}</div>` + ch.goals.filter(g => !g.show || g.show(G)).map(g => `<div class="g ${g.ok(G) ? 'done' : ''}${g.alt ? ' alt' : ''}">${ic(g.ok(G) ? 'ok' : g.ic)}${esc(g.t)}</div>`).join('') + qs;
    if (gh !== goalCache) { goalCache = gh; $('goals').innerHTML = gh; }
    // навыки и снаряжение
    const sk = Object.keys(SKILLS).map(k => {
      const l = Hero.lvl(k), x = G.skills[k], a = LV[l - 1], b = LV[l] || LV[l - 1] + 1, pr = l >= 5 ? 1 : (x - a) / (b - a);
      return `<span class="ring" style="--p:${pr}" title="${SKILLS[k].n}">${ic(SKILLS[k].i)}<b>${l}</b></span>`;
    }).join('') + '<i class="sep"></i>' + Object.keys(GEAR).map(k => `<span class="gear ${G.gear[k] ? 'on' : ''}" title="${GEAR[k].n} · ${icPlain(GEAR[k].d)}">${ic(GEAR[k].i)}</span>`).join('');
    if (sk !== skillCache) { skillCache = sk; $('skills').innerHTML = sk; }
    // подсказки действий
    const items = [];
    const K = (key, i) => (isTouch ? '' : `<kbd>${key}</kbd>`) + ic(i, 's');
    const pl = Actions.plate, c = pl ? null : ctxCache;
    if (pl) items.push(['E', `${ic(pl.note ? 'log' : 'ok', 's')}${pl.page + 1 < pl.pages ? 'Дальше' : pl.note ? 'Положить' : 'Закрыть'}<kbd>E</kbd>`]); // плашка записки/осмотра
    else if (c) items.push(['E', `${ic('axe', 's')}${esc(c.label)}<kbd>E</kbd>`]);
    const al = !G.p.sleeping && Actions.altLabel(c); // второе действие: X или долгое E (на таче — удержать кнопку)
    if (al) items.push(['X', `${ic(al[1], 's')}${esc(al[0])}` + (isTouch ? '' : `<kbd>${c && c.alt && !c.rep ? 'E…' : 'X'}</kbd>`)]);
    if (!G.p.inside && !G.p.sleeping) {
      const f = Actions.nearest(G.fires, 70);
      if (f) items.push(['F', f.fuel > 0 ? `${ic('fire', 's')}Подбросить ${ic('wood', 's')}1<kbd>F</kbd>` : `${ic('fire', 's')}Разжечь ${ic('wood', 's')}2<kbd>F</kbd>`]);
      else if (Inv.cnt('wood', false) >= 3 && !c) items.push(['F', `${ic('fire', 's')}Костёр ${ic('wood', 's')}3<kbd>F</kbd>`]);
      if ((Inv.has('snare', false) || Inv.has('trap', false)) && !onIce(G.p.x, G.p.y)) items.push(['R', `${ic(World.inCedar(G.p.x, G.p.y) && Inv.has('trap', false) ? 'trap' : Inv.has('snare', false) ? 'snare' : 'trap', 's')}Поставить<kbd>R</kbd>`]);
      if (!onIce(G.p.x, G.p.y) && Inv.weight() > Inv.capKg() && (!c || c.k !== 'stash')) items.push(['T', `${ic('pack', 's')}Тайник<kbd>T</kbd>`]);
    }
    if (G.s.food < 60 && FOOD_ORDER.some(k => Inv.cnt(k, G.p.inside) > 0)) items.push(['Q', `${ic('food', 's')}Есть<kbd>Q</kbd>`]);
    // «До утра»: ночью; во время промотки — часы и стоп
    const zk = isTouch ? '' : '<kbd>Z</kbd>';
    if (Actions.skipFast()) items.push(['Z', `${ic('timer', 's')}${hh}:${mm} → ${String(TUNE.time.wakeAt).padStart(2, '0')}:00 · Стоп${zk}`]);
    else if (Actions.nightNow() && !G.p.ko && !G.p.ride && !Actions.busy() && !Actions.skipping()) items.push(['Z', `${ic(Actions.skipMode() === 'sleep' ? 'sleep' : 'night', 's')}До утра${zk}`]);
    const ph = items.map(([k, t]) => `<button class="btn sec pbtn" data-k="${k}">${t}</button>`).join('');
    if (ph !== promptCache) { promptCache = ph; $('prompt').innerHTML = ph; }
  }
  $('cmdbar').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const c = b.dataset.cmd;
    if (c === 'place') Colony.place(); else if (c === 'cancel') G.col.ghost = null;
    else if (c === 'desel') { G.col.sel = []; if (isTouch) setOrder(false); }
    else if (c === 'focus') focusSel();
    else if (c === 'order') setOrder(false);
    else if (c === 'grp') { if (grpHeld) { grpHeld = false; return; } groupGet(+b.dataset.g); }
    else Colony.setTaskAll(c);
  });
  // долгое нажатие на чип группы = запомнить выделенных (для телефона)
  let grpHold = null, grpHeld = false;
  $('cmdbar').addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-cmd="grp"]'); if (!b) return;
    grpHeld = false; clearTimeout(grpHold);
    grpHold = setTimeout(() => { grpHeld = true; groupSet(+b.dataset.g); }, 550);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('cmdbar').addEventListener(ev, () => clearTimeout(grpHold));

  // ---------- посёлок: к выделенным, группы, двойной клик, стрелки за экраном ----------
  const toScreen = GFX.worldToScreen;
  const onScreen = u => { const p = toScreen(u.x, u.y - 14); return p.x > 0 && p.y > 0 && p.x < innerWidth && p.y < innerHeight; };
  // камера на выделенных: центр рамки, при нужде — отдалить, чтобы влезли все
  function focusSel(quiet) {
    const us = Colony.selected();
    if (!us.length) { if (!quiet) toast(':people: Никто не выделен'); return false; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const u of us) { x0 = Math.min(x0, u.x); x1 = Math.max(x1, u.x); y0 = Math.min(y0, u.y - 14); y1 = Math.max(y1, u.y - 14); }
    const fit = Math.min(innerWidth / (x1 - x0 + 260), innerHeight / (y1 - y0 + 320));
    if (fit < GFX.zoom) GFX.setZoom(fit);
    GFX.lookAt((x0 + x1) / 2, (y0 + y1) / 2);
    return true;
  }
  const groups = () => G.col.groups || (G.col.groups = {});
  const grpAlive = k => (groups()[k] || []).filter(id => G.col.units.some(u => u.id === id && !u.hidden));
  function grpChips() {
    let h = '';
    for (const k of [1, 2, 3]) { const n = grpAlive(k).length; if (n || G.col.sel.length) h += `<button class="btn sec mini grp ${n ? '' : 'empty'}" data-cmd="grp" data-g="${k}" title="${isTouch ? 'тап — выбрать · держать — запомнить' : k + ' — выбрать · Ctrl+' + k + ' — запомнить'}">${k}${n ? `<small>${n}</small>` : ''}</button>`; }
    return h;
  }
  function groupSet(k) {
    const ids = G.col.sel.slice();
    if (!ids.length) { delete groups()[k]; toast(`:people: Группа ${k} очищена`); return; }
    groups()[k] = ids; toast(`:people: Группа ${k}: ${ids.length}`); Sound.pick();
  }
  let grpLast = { k: 0, t: 0 };
  function groupGet(k) {
    const ids = grpAlive(k);
    if (!ids.length) return toast(`:people: Группа ${k} пуста · ${isTouch ? 'держи кнопку' : 'Ctrl+' + k} — запомнить`);
    const t = performance.now(), again = grpLast.k === k && t - grpLast.t < 450; grpLast = { k, t };
    G.col.sel = ids;
    if (again || isTouch) focusSel(true); // повторное нажатие (или тап на телефоне) — камера к группе
  }
  // двойной клик / тап по человеку — js/input.js (свой счётчик кликов)
  // стрелки на краю экрана к выделенным, которых не видно (по 16 направлениям, с числом)
  const offEl = $('offsel');
  function offscreen() {
    const us = state === 'play' && !kind ? Colony.selected() : [];
    const Wd = innerWidth, Hd = innerHeight, pad = 30, bins = new Map();
    for (const u of us) {
      if (onScreen(u)) continue;
      const p = toScreen(u.x, u.y - 14), a = Math.atan2(p.y - Hd / 2, p.x - Wd / 2), k = Math.round(a / (Math.PI / 8));
      const b = bins.get(k) || { a: 0, n: 0, ic: UNITS[u.type].i, x: 0, y: 0 }; b.n++; b.a += a; b.x += u.x; b.y += u.y - 14; bins.set(k, b);
    }
    // по эллипсу у края (0.8 полуосей), чтобы не лезть на углы HUD; кнопки переиспользуются
    const list = [...bins.values()];
    while (offEl.children.length > list.length) offEl.lastChild.remove();
    while (offEl.children.length < list.length) { const e = document.createElement('button'); e.className = 'offa'; e.setAttribute('aria-label', 'К выделенным'); e.innerHTML = '<i></i><span></span>'; offEl.appendChild(e); }
    list.forEach((b, i) => {
      const e = offEl.children[i], a = b.a / b.n, rx = Wd / 2 - pad, ry = Hd / 2 - pad;
      const k = 0.82 / Math.hypot(Math.cos(a) / rx, Math.sin(a) / ry);
      e.style.left = Math.round(Wd / 2 + Math.cos(a) * k) + 'px'; e.style.top = Math.round(Hd / 2 + Math.sin(a) * k) + 'px';
      e.dataset.x = Math.round(b.x / b.n); e.dataset.y = Math.round(b.y / b.n);
      e.firstChild.style.transform = `rotate(${a.toFixed(2)}rad)`;
      setHtmlOnce(e.lastChild, ic(b.ic, 's') + (b.n > 1 ? '×' + b.n : ''));
    });
  }
  offEl.addEventListener('pointerdown', e => { const b = e.target.closest('.offa'); if (!b) return; e.preventDefault(); e.stopPropagation(); GFX.lookAt(+b.dataset.x, +b.dataset.y); });
  // телефон: режим приказов — джойстик убран, весь экран для тапов (выбрать людей / приказ / щипок)
  let orderMode = false, selN = 0;
  function setOrder(on) {
    orderMode = !!on; document.body.classList.toggle('order-mode', orderMode); $('t-cmd').classList.toggle('on', orderMode);
    $('t-cmd').setAttribute('aria-pressed', orderMode);
    if (orderMode) { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; }
    delete $('cmdbar').dataset.c; hud(true);
  }
  $('prompt').addEventListener('click', e => { const b = e.target.closest('.pbtn'); if (b) keyAction(b.dataset.k); });

  // ---------- мини-карта ----------
  // Масштаб постоянный: MAP_SPAN px мира на 128 px карты — окрестность героя (A9: ~2,5 км; при ×1 — весь мир, как раньше).
  // У края мира окно упирается в край. Весь мир — большая карта (M, js/map.js).
  // Подложка печётся на весь мир в том же масштабе и перепекается, когда лес заметно поредел.
  const MAP_SPAN = W > WORLD.BASE ? 2400 : Math.min(W, H), MS = 128 / MAP_SPAN;
  const mm = $('minimap'), mx = mm.getContext('2d');
  const mbase = document.createElement('canvas'); mbase.width = Math.ceil(W * MS); mbase.height = Math.ceil(H * MS);
  let mapWin = { x: 0, y: 0 }, mapFelled = -1;
  const felled = () => { let n = 0; for (const t of G.trees) if (t.wood <= 0) n++; return n; };
  function bakeMap() {
    const g = mbase.getContext('2d');
    g.fillStyle = '#c9d6e0'; g.fillRect(0, 0, mbase.width, mbase.height);
    g.fillStyle = 'rgba(40,80,60,0.35)'; for (const t of G.trees) if (!t.wall && t.wood > 0) g.fillRect(t.x * MS, t.y * MS, 1, 1);
    g.strokeStyle = '#7fb0cf'; g.lineWidth = 4; g.beginPath(); for (let y = 0; y <= H; y += 40) g.lineTo(riverX(y) * MS, y * MS); g.stroke();
    g.fillStyle = 'rgba(160,140,110,0.5)'; g.beginPath(); g.arc(POI.mar.x * MS, POI.mar.y * MS, POI.mar.r * MS, 0, 7); g.fill();
    g.fillStyle = '#6b5238'; g.fillRect((HUT.x - 100) * MS, (HUT.y - 100) * MS, 200 * MS, 140 * MS);
    // зоны: оттенок по карте зон, объекты — точками
    const C = Zones.C * MS, TC = { naled: 'rgba(140,195,230,.55)', gar: 'rgba(43,47,58,.3)', kurum: 'rgba(108,113,120,.35)', golets: 'rgba(246,249,252,.6)', drill: 'rgba(184,57,45,.15)', meteo: 'rgba(63,111,122,.2)', zimnik: 'rgba(143,124,92,.2)', stoibishe: 'rgba(199,154,98,.3)' };
    if (Zones.built !== null) for (let j = 0; j < Zones.NY; j++) for (let i = 0; i < Zones.NX; i++) { const z = Zones.zid(j * Zones.NX + i), id = z && Zones.IDS[z - 1]; if (id && TC[id]) { g.fillStyle = TC[id]; g.fillRect(i * C, j * C, C + 0.5, C + 0.5); } }
    g.fillStyle = '#27394a'; for (const o of Zones.OBJS) if (o.type !== 'spot' && o.type !== 'steam') g.fillRect(o.x * MS - 1.5, o.y * MS - 1.5, 3, 3);
    mapFelled = felled();
  }
  function drawMap() {
    if (felled() - mapFelled >= 8) bakeMap();
    // буфер 128 × DPR × масштаб интерфейса (без мыла на Retina и при L)
    const md = Math.min(3, (devicePixelRatio || 1) * (UI_SCALE.v || 1)), mpx = Math.round(128 * md);
    if (mm.width !== mpx) { mm.width = mm.height = mpx; }
    mx.setTransform(mpx / 128, 0, 0, mpx / 128, 0, 0);
    const p = G.p;
    mapWin = { x: clamp(p.x - MAP_SPAN / 2, 0, W - MAP_SPAN), y: clamp(p.y - MAP_SPAN / 2, 0, H - MAP_SPAN) };
    const ox = mapWin.x, oy = mapWin.y, X = x => (x - ox) * MS, Y = y => (y - oy) * MS;
    mx.fillStyle = '#111a15'; mx.fillRect(0, 0, 128, 128);
    // открытые клетки тумана внутри окна
    const fc = World.FOG.cell, c = fc * MS;
    const i0 = Math.floor(ox / fc), i1 = Math.min(World.FOG.nx - 1, Math.floor((ox + MAP_SPAN - 1) / fc));
    const j0 = Math.floor(oy / fc), j1 = Math.min(World.FOG.ny - 1, Math.floor((oy + MAP_SPAN - 1) / fc));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (G.fog[j * World.FOG.nx + i]) mx.drawImage(mbase, i * c, j * c, c + 0.5, c + 0.5, X(i * fc), Y(j * fc), c + 0.5, c + 0.5);
    for (const k in POI) if (G.known[k] && k !== 'labaz') Icons.draw(mx, POI[k].ic, X(POI[k].x), Y(POI[k].y), 14, '#ebe6d3', 'rgba(11,18,14,.9)');
    const tg = Story.goalTarget();
    if (tg) { mx.fillStyle = '#ffd27a'; mx.beginPath(); mx.arc(clamp(X(tg.x), 3, 125), clamp(Y(tg.y), 3, 125), 3 + Math.sin(now * 5), 0, 7); mx.fill(); }
    for (const n of Npc.list()) if (n.id === 'urk') { mx.fillStyle = '#c89468'; mx.fillRect(X(n.st.x) - 1.5, Y(n.st.y) - 1.5, 3, 3); }
    for (const z of Zones.ACT) if (G.zoneSeen[z.id]) { const zx = X(z.x), zy = Y(z.y); if (zx > -8 && zx < 136 && zy > -8 && zy < 136) Icons.draw(mx, z.ic, zx, zy, 13, '#ebe6d3', 'rgba(11,18,14,.9)'); }
    if (G.veh) for (const k of ['deer', 'buran']) { const v = G.veh[k]; if (v && G.p.ride !== k && (k === 'deer' || v.fixed)) Icons.draw(mx, k === 'deer' ? 'deer' : 'sled', X(v.x), Y(v.y), 11, '#ffd27a', 'rgba(11,18,14,.9)'); }
    for (const s of G.stashes || []) Icons.draw(mx, 'pack', X(s.x), Y(s.y), 11, '#ffd27a', 'rgba(11,18,14,.9)');
    mx.fillStyle = '#ff4f3a'; mx.beginPath(); mx.arc(X(p.x), Y(p.y), 3, 0, 7); mx.fill();
    mx.strokeStyle = '#fff'; mx.lineWidth = 1; mx.stroke();
    // видимая часть мира
    mx.strokeStyle = 'rgba(255,210,122,.8)'; mx.strokeRect(X(cam.x), Y(cam.y), GFX.vw * MS, GFX.vh * MS);
  }
  // клик/тап по мини-карте — камера туда (герой остаётся на месте)
  function mapLook(e) {
    if (state !== 'play' || kind) return;
    const r = mm.getBoundingClientRect(); if (!r.width) return;
    GFX.lookAt(mapWin.x + (e.clientX - r.left) / r.width * MAP_SPAN, mapWin.y + (e.clientY - r.top) / r.height * MAP_SPAN); mapT = 0;
  }
  let mapDrag = false;
  mm.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (document.body.classList.contains('narrow')) return openMap(); mapDrag = true; try { mm.setPointerCapture(e.pointerId); } catch (_) {} mapLook(e); });
  mm.addEventListener('pointermove', e => { if (mapDrag) mapLook(e); });
  for (const ev of ['pointerup', 'pointercancel']) mm.addEventListener(ev, () => { mapDrag = false; });
  $('cam-btn').addEventListener('click', () => { GFX.recenter(); GFX.zoomTo(1); });
  $('map-btn').addEventListener('click', () => { if (kind === 'map') closePanel(); else openMap(); });

  // ---------- цель: метки компаса — MARKERS (js/content/chapters.js), выбор цели — Story.goalTarget ----------

  function ctxTarget() {
    const c = ctxCache; if (!c) return null;
    const o = c.o;
    if (c.npc) return { x: o.x, y: o.y, h: NPCS[c.k].h || 60 };
    switch (c.k) {
      case 'tree': return { x: o.x, y: o.y, h: 100 * o.s };
      case 'wolf': return { x: o.x, y: o.y, h: 36 }; case 'bear': return { x: o.x, y: o.y, h: 60 };
      case 'hare': return { x: o.x, y: o.y, h: 26 };
      case 'note': { const q = Live.notePos(o, {}); return { x: q.x, y: q.y, h: 14 }; }
      case 'stove': return { x: SPOT.stove.x, y: SPOT.stove.y, h: 76 }; case 'bench': return { x: SPOT.bench.x, y: SPOT.bench.y, h: 36 };
      case 'chest': return { x: SPOT.chest.x, y: SPOT.chest.y, h: 22 }; case 'bed': return { x: SPOT.bed.x, y: SPOT.bed.y, h: 16 };
      case 'trap': return { x: o.x, y: o.y, h: 18 }; case 'stack': return { x: o.x, y: o.y, h: 30 };
      case 'wreck': return { x: POI[o].x, y: POI[o].y, h: 70 }; case 'tube': return { x: TUBE_POS.x, y: TUBE_POS.y, h: 8 };
      case 'labaz': return { x: POI.labaz.x, y: POI.labaz.y, h: 76 }; case 'fish': return { x: o.x, y: o.y, h: 10 };
      case 'throw': return { x: o.x, y: o.y, h: 36 }; case 'dog': return { x: o.x, y: o.y, h: 30 }; case 'fire': return { x: o.x, y: o.y, h: 34 };
      case 'drift': return { x: G.p.x + G.p.face * 16, y: G.p.y, h: 8 }; case 'tracks': return { x: o.x, y: o.y, h: 6 }; case 'rest': return { x: o.x, y: o.y, h: 16 };
    }
    return null;
  }

  // ---------- кадр ----------
  function frame(dt) {
    if (state !== 'play') return;
    Input.tick(dt);
    if (G.p.moving) tips.did('move');
    const modal = !!kind; if (modal !== frame.modal) { frame.modal = modal; document.body.classList.toggle('modal', modal); layout(); }
    const free = GFX.free || Math.abs(GFX.zoom - 1) > 0.02; if ($('cam-btn').hidden === free) $('cam-btn').hidden = !free;
    tips.tick(dt);
    hudT -= dt; mapT -= dt;
    if (hudT <= 0) { hudT = window.QUALITY === 'low' ? 0.16 : 0.08; ctxCache = Actions.context(); hud(); offscreen(); diaryTick(); layout(); }
    const n = G.col.sel.length; if (isTouch && n && !selN && !orderMode) setOrder(true);
    if (n !== selN) $('t-cmd').dataset.n = n || ''; selN = n;
    if (mapT <= 0) { mapT = 0.3; drawMap(); }
    if (TK) TK.tick(dt);   // постановка разговора: камера, подход, жесты, мимика (и бытовые реплики)
    if (kind === 'dialog' && dlg && typeN < dlg.t.length) {
      typeT += dt * 45; const n = Math.max(0, Math.min(dlg.t.length, Math.floor(typeT)));
      if (n !== typeN) { typeN = n; $('dlg-text').textContent = dlg.t.slice(0, n); if (n >= dlg.t.length) renderOpts(); }
    }
    if (kind === 'dialog' && dlg && typeN >= dlg.t.length) dlgT += dt;
    if (kind === 'note') { noteT += dt; }
    if (kind === 'map') WorldMap.tick(dt);
    if (kind === 'craft' || kind === 'chest' || kind === 'trade') { panelT = (panelT || 0) - dt; if (panelT <= 0) { panelT = 0.5; renderPanel(); } }
  }
  let panelT = 0;

  // ---------- финалы: экран гибели (.rv) и итоговый акт (.doc) со штампом по концовке ----------
  // дневник партии для акта: тепло по дням (минимум за сутки) и дни вех — ведётся в кадре, живёт до новой игры
  let diary = { warm: {}, miles: {} };
  const MILES = [['hutFound', 'hut', 'Изба найдена'], ['metUrk', 'evenk', 'Встреча с Уркачаном'], ['radioBuilt', 'radio', 'Рация собрана'], ['siegeDone', 'wolf', 'Осада снята'],
    ['contact', 'antenna', 'Связь с бортом'], ['bearDead', 'bear', 'Шатун проводили'], ['rescued', 'heli', 'Вертолёт сел'],
    ['bigStormDone', 'storm', 'Большая пурга пережита'], ['expArrived', 'mast', 'Дошли до Кербо-2'], ['expCalled', 'antenna', 'Сеанс с Турой'], ['expRescued', 'heli', 'Борт у мачты']];
  function diaryTick() {
    const d = G.day, w = Math.round(G.s.warm);
    if (diary.warm[d] == null || w < diary.warm[d]) diary.warm[d] = w;
    for (const [f] of MILES) if (G.flags[f] && !diary.miles[f]) diary.miles[f] = d;
  }
  const END_META = { A: ['спасены', 'heli'], B: ['спасён', 'heli'], C: ['остался', 'tree'], D: ['остались', 'people'], E: ['дошли', 'radio'] };
  const tileH = (i, v, l, cls) => `<div class="tile ${cls || ''}">${ic(i)}<b>${v}</b>${l}</div>`;
  function end(k, cause) {
    $('touch').hidden = true; closePanel(); tips.hide();
    document.body.classList.add('end-screen');
    const act = k !== 'death';
    let icn, title, text;
    if (!act) [icn, title, text] = DEATH[cause] || DEATH.cold;
    else [icn, title, text] = ENDINGS[k];
    const card = $('o-card'); card.classList.toggle('doc', act); card.classList.toggle('rv', !act);
    const h = hourOf(), hm = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor(h % 1 * 60)).padStart(2, '0')}`;
    $('o-ic').innerHTML = act ? '' : `<svg class="ic bigic"><use href="#i-${icId(icn)}"/></svg>`;
    $('o-title').innerHTML = (act ? ic(END_META[k] ? END_META[k][1] : icn, 'l') : '') + esc(title);
    $('o-text').innerHTML = esc(text);
    if (act && (k === 'A' || k === 'B')) $('o-text').innerHTML = esc(text + (G.col.ep >= 3 ? ' Посёлок остался зимовать — ' + Colony.pop() + ' человек.' : '') + (Object.keys(G.notes).length >= 6 ? ' Ты прочитал почти все записки. Семёныча помянули.' : ''));
    // гибель: чип «ночь · время · мороз», плитки с нехваткой красным
    $('o-chip').hidden = act;
    if (!act) $('o-chip').innerHTML = `${ic(daylight(h) > 0.5 ? 'day' : 'night', 's')}день ${G.day} · ${hm} · −${Math.abs(temperature())}°`;
    // акт: шапка, штамп, столбики тепла по дням, вехи, подпись, атрибуция
    let n = 1; try { n = (+localStorage.getItem('sibir-acts') || 0) + 1; if (act) localStorage.setItem('sibir-acts', n); } catch (e) {}
    $('o-head').hidden = $('o-stamp').hidden = $('o-days').hidden = $('o-rows').hidden = $('o-sign').hidden = $('o-credits').hidden = $('o-menu').hidden = !act;
    if (act) {
      $('o-head').textContent = `акт № ${n} · эвенкия · ${String(13 + G.day).padStart(2, '0')}.01.1993`;
      $('o-stamp').textContent = END_META[k] ? END_META[k][0] : 'итог';
      const days = [], d1 = Math.max(7, G.day); for (let d = d1 - 6; d <= d1; d++) days.push(d);
      diaryTick();
      $('o-days').style.setProperty('--n', days.length);
      $('o-days').innerHTML = days.map(d => { const w = diary.warm[d]; return `<div title="день ${d}: тепло ${w == null ? '—' : w}"><i class="${w != null && w < 25 ? 'bad' : ''}" style="--w:${w == null ? 0 : Math.max(4, w)}"></i>${d}</div>`; }).join('');
      $('o-rows').innerHTML = MILES.filter(([f]) => diary.miles[f] || G.flags[f]).map(([f, i, t]) => `<div class="row done"><span class="ri">${ic('ok')}</span><span class="rn">${t}<small>${diary.miles[f] ? 'день ' + diary.miles[f] : ''}</small></span><span></span>${ic(i, 's')}</div>`).join('') || '<p class="hint">без происшествий</p>';
    }
    const miss = { cold: 'warm', food: 'food', wolf: 'hp', bear: 'hp' }[cause] || 'warm';
    $('o-stats').innerHTML = (act ? '' : tileH(miss, 0, { warm: 'тепло', food: 'еда', hp: 'здоровье' }[miss], 'miss'))
      + tileH('day', G.day, 'день') + tileH('wood', G.stats.wood, 'дров') + tileH('fish', G.stats.fish, 'рыб')
      + tileH('hare', G.stats.hares, 'зайцев') + tileH('wolf', G.stats.wolves, 'волков') + tileH('evenk', G.urk.respect + '/3', 'дед')
      + tileH('people', Colony.pop(), 'людей') + tileH('sevek', G.amulets, 'сэвэки') + (G.stats.bestKg ? tileH('fish', G.stats.bestKg.toFixed(1), 'кг рекорд', 'gain') : '');
    $('o-retry').hidden = !(!act && checkpoint); $('again').className = 'btn ' + ($('o-retry').hidden ? 'pri' : 'sec');
    $('over').hidden = false;
    if (act) Saves.clear('auto'); // финал: автосейв больше не нужен, ручные ячейки остаются
    setTimeout(() => ($('o-retry').hidden ? $('again') : $('o-retry')).focus(), 60);
  }
  // из итога — в главное меню (диорама у избы)
  function toMenu() {
    state = 'menu'; kind = null; document.body.classList.remove('end-screen', 'modal', 'paused');
    ['over', 'pause', 'slots', 'dialog', 'panel', 'note', 'chapter', 'hud', 'touch'].forEach(id => $(id).hidden = true);
    menuWorld(); GFX.reset(); menuButtons(); $('menu').hidden = false;
  }
  // ---------- старт ----------
  function start(fromSave) {
    Sound.init();
    if (fromSave) { SaveGame.load(fromSave); checkpoint = fromSave; }
    else { newGame(); GFX.reset(); SaveGame.checkpoint(); }
    bakeMap();
    Hero.bodyReset(); // автомат тела — под новое G (память прошлой партии не переносится)
    state = 'play'; kind = null; goalCache = invCache = promptCache = skillCache = ''; tips.hide();
    ['menu', 'over', 'pause', 'slots', 'dialog', 'panel', 'note', 'chapter'].forEach(id => $(id).hidden = true);
    if (isTouch) setOrder(false);
    document.body.classList.remove('paused', 'end-screen');
    if (!fromSave || !diary.warm[G.day]) diary = { warm: {}, miles: {} };
    $('touch').hidden = !isTouch; $('hud').hidden = false;
    hud(true); drawMap();
    if (!fromSave) setTimeout(() => chapter(0), 300);
    else toast(typeof fromSave === 'string' && start.msg ? start.msg : ':retry: С последнего сна');
    start.msg = null;
  }
  function retry() {
    const ch = JSON.parse(checkpoint).chapter;
    start(checkpoint);
    G.s.hp = Math.max(G.s.hp, 60); G.s.warm = Math.max(G.s.warm, 50); G.s.food = Math.max(G.s.food, 40); G.wolves = []; G.pack = null; if (G.bear) G.bear = null;
    if ((deathLog[ch] || 0) >= 2) {
      G.mercy = 1; G.chest.wood = (G.chest.wood || 0) + 4; G.chest.meat = (G.chest.meat || 0) + 2;
      toast(':evenk: Уркачан оставил в лабазе :wood:4 :meat:2');
    }
  }
  // журнал: прочитанные записки (текст сохраняется, перечитать — в паузе, раздел «Записки»)
  function journal() {
    const pt = $('p-tire'), s = G.s; if (pt) { const pw = Math.round(100 - (s.tire || 0)), aw = Math.floor((s.awake || 0) / HOUR);
      pt.innerHTML = `<span class="ri">${ic('tire')}</span><span>Силы</span><span class="badges">${bdg(pw < TUNE.tire.low ? 'miss' : 'ok', ic('tire', 's') + pw)}${bdg(aw >= TUNE.tire.awakeFrom ? 'miss' : '', ic('sleep', 's') + aw + ' ч')}</span>`; }
    const ids = Object.keys(NOTES).filter(id => G.notes[id]), el = $('p-notes'); if (!el) return;
    $('p-notes-n').textContent = `${ids.length}/${Object.keys(NOTES).length}`;
    el.innerHTML = ids.length ? ids.map(id => `<div class="jn">${ic(NOTES[id].i || 'log', 's')}<span>${esc(NOTES[id].t)}</span></div>`).join('') : '<p class="hint">Пока пусто</p>';
  }
  $('p-notes-b') && $('p-notes-b').addEventListener('click', () => { const el = $('p-notes'); el.hidden = !el.hidden; $('p-notes-b').classList.toggle('on', !el.hidden); });
  function pause(on) {
    if (on && state === 'play') { state = 'pause'; $('pause').hidden = false; input.act = false; keys.clear(); journal(); }
    else if (!on && state === 'pause') { state = 'play'; $('pause').hidden = true; }
    document.body.classList.toggle('paused', state === 'pause');
  }

  // ---------- ввод ----------
  const keys = new Set(), joy = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
  const SHIFT_TAP = 350; let shiftTap = 0; // мс: чистое нажатие Shift без цели — отскок назад на отпускании (см. keydown)
  function keyAction(k) {
    if (state !== 'play') return;
    tips.did({ E: 'act', F: 'fire', Q: 'eat', B: 'build', C: 'craft' }[k]);
    if (k === 'E') { if (Actions.fishStrike()) return; if (G.col.ghost && G.col.ghost.touch) return Colony.place(); Actions.interact(false); }
    else if (k === 'X') Actions.alt();
    else if (k === 'H') Colony.alarm();
    else if (k === 'V') Actions.sniff();
    else if (k === 'B') { if (!kind) openCraft('build'); }
    else if (k === '.') Colony.selectIdle();
    else if (k === 'F') Actions.fireKey();
    else if (k === 'Q') Actions.eat();
    else if (k === 'R') Actions.placeKey();
    else if (k === 'T') Actions.stashKey();
    else if (k === 'C') { if (kind === 'craft') closePanel(); else if (!kind) openCraft(G.p.inside && G.hut.bench ? 'craft' : panelTab); }
    else if (k === 'Z') { if (!kind) Actions.skipKey(); }
  }
  function syncMove() {
    let mx_ = 0, my_ = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) my_ -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) my_ += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx_ -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx_ += 1;
    input.mx = kind ? 0 : mx_ + joy.x; input.my = kind ? 0 : my_ + joy.y;
    if (Math.hypot(input.mx, input.my) > 0.15) input.auto = 0; // свой шаг игрока снимает автопуть (к лежанке)
    const s = Input.steer(mx_ + joy.x, my_ + joy.y); if (s && !kind) { input.mx = s.x; input.my = s.y; } // путь героя по ПКМ
  }
  addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') { if (e.code === 'Escape') e.target.blur(); else return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (state === 'menu' || state === 'over') { if (e.code === 'Enter') { if (state === 'over' && checkpoint && !$('o-retry').hidden) retry(); else if (state === 'menu') start(); } return; }
    if (!$('slots').hidden) { if (e.code === 'Escape') slotsClose(); return; }
    if (state === 'pause') { if (e.code === 'Escape' || e.code === 'KeyP' || e.code === 'Enter') pause(false); return; }
    if (kind === 'dialog') {
      if (/^Digit[1-4]$/.test(e.code)) choose(+e.code.slice(5) - 1);
      else if (['KeyE', 'Space', 'Enter'].includes(e.code) && !e.repeat) { if (typeN < dlg.t.length || (dlg.opts || [0]).length === 1) choose(0); }
      else if (e.code === 'Escape') { closePanel(); }
      else if (/^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(e.code) && !e.repeat && dlgT + typeN / 45 > 0.4) { closePanel(); keys.add(e.code); }   // ушёл — разговор прерван
      return;
    }
    if (kind === 'skip' && (e.code === 'KeyZ' || e.code === 'Enter') && !e.repeat) { closePanel(); Actions.skipStart(); return; }
    if (kind) {
      if (e.code === 'Escape' || (e.code === 'KeyM' && kind === 'map') || (e.code === 'KeyE' && kind === 'note' && noteT > 0.3) || (e.code === 'KeyC' && kind === 'craft') || (e.code === 'KeyE' && kind !== 'note' && !e.repeat)) closePanel();
      return;
    }
    if (e.code === 'Escape' && G.col.ghost) { G.col.ghost = null; return; }
    if (e.code === 'Escape' && G.col.sel.length) { G.col.sel = []; return; }
    if (e.code === 'Escape' && Actions.reading()) { Actions.plateClose(true); return; } // плашка записки: положить лист
    if (e.code === 'Escape' || e.code === 'KeyP') { pause(true); return; }
    keys.add(e.code);
    if (e.repeat) return;
    const shift = e.code === 'ShiftLeft' || e.code === 'ShiftRight';
    if (!shift) shiftTap = 0;   // Shift с другой клавишей — сочетание (Cmd+Shift+4 — снимок экрана, Shift+буква), не отскок
    if (e.code === 'KeyE' || e.code === 'Space') { input.act = true; keyAction('E'); }
    // отскок (рывок по направлению / от угрозы); с выделенными людьми Shift — добавить к выделению.
    // Есть куда (ввод, падающий ствол, волк) — сразу; иначе («назад») — только на чистое короткое нажатие Shift (на отпускании):
    // стоящий герой не отпрыгивает от Shift в составе сочетаний и с модификаторами
    if (shift && !G.col.sel.length && !e.metaKey && !e.ctrlKey && !e.altKey) { if (Hero.dodgeAim()) Hero.dodge(); else shiftTap = performance.now(); }
    if (e.code === 'KeyF') keyAction('F');
    if (e.code === 'KeyX') keyAction('X');
    if (e.code === 'KeyQ') keyAction('Q');
    if (e.code === 'KeyR') keyAction('R');
    if (e.code === 'KeyT') keyAction('T');
    if (e.code === 'KeyC') keyAction('C');
    if (e.code === 'KeyZ') keyAction('Z');
    if (e.code === 'KeyH') keyAction('H');
    if (e.code === 'KeyM') openMap();
    if (e.code === 'KeyV') keyAction('V');
    if (e.code === 'KeyB') keyAction('B');
    if (e.code === 'Period') keyAction('.');
    if (e.code === 'Equal' || e.code === 'NumpadAdd') { GFX.zoomBy(1.25); tips.did('zoom'); }
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') { GFX.zoomBy(1 / 1.25); tips.did('zoom'); }
    if (e.code === 'Digit0' || e.code === 'Numpad0') { GFX.recenter(); GFX.zoomTo(1); }
    if (e.code === 'KeyG') focusSel();
    const g = /^(Digit|Numpad)([1-3])$/.exec(e.code);
    if (g) { if (e.ctrlKey || e.metaKey || e.shiftKey) { e.preventDefault(); groupSet(+g[2]); } else groupGet(+g[2]); }
  });
  addEventListener('keyup', e => {
    keys.delete(e.code); if (e.code === 'KeyE' || e.code === 'Space') input.act = false;
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && shiftTap) {
      const tap = performance.now() - shiftTap < SHIFT_TAP && !(input.downAt >= shiftTap) && !e.metaKey && !e.ctrlKey && !e.altKey; shiftTap = 0;
      if (tap && state === 'play' && !kind && !G.col.sel.length) Hero.dodge();
    }
  });
  addEventListener('blur', () => { keys.clear(); input.act = false; shiftTap = 0; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });

  const zoneEl = $('stickzone'), stick = $('stick'), knob = $('knob');
  zoneEl.addEventListener('pointerdown', e => {
    if (joy.id !== null) return;
    joy.id = e.pointerId; zoneEl.setPointerCapture(e.pointerId); joy.t0 = performance.now(); joy.moved = false;
    const r = zoneEl.getBoundingClientRect(); joy.ox = e.clientX; joy.oy = e.clientY;
    // джойстик под пальцем, но целиком в зоне
    stick.style.left = clamp(e.clientX - r.left, 58, r.width - 58) + 'px'; stick.style.top = clamp(e.clientY - r.top, 58, r.height - 58) + 'px'; stick.style.bottom = 'auto';
  });
  zoneEl.addEventListener('pointermove', e => {
    if (e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const l = Math.hypot(dx, dy), m = 45;
    if (l > m) { dx = dx / l * m; dy = dy / l * m; }
    if (l >= 12) joy.moved = true;
    joy.x = dx / m; joy.y = dy / m; knob.style.transform = `translate(${dx}px,${dy}px)`;
  });
  // зона джойстика только ведёт героя; приказы — в режиме приказов (кнопка «люди»; там джойстика нет).
  // Исключение: место стройки — короткий тап ставит призрак постройки туда.
  const joyEnd = e => {
    if (e.pointerId !== joy.id) return;
    // короткий тап по человеку — выбрать (включит режим приказов); по пустому месту — ничего
    if (e.type === 'pointerup' && !joy.moved) Input.joyTap(e);
    joy.id = null; joy.x = joy.y = 0; knob.style.transform = '';
  };
  zoneEl.addEventListener('pointerup', joyEnd); zoneEl.addEventListener('pointercancel', joyEnd);
  const act = $('t-act');
  act.addEventListener('pointerdown', e => { e.preventDefault(); if (kind === 'dialog') { if (typeN < dlg.t.length || (dlg.opts || [0]).length === 1) choose(0); return; } if (kind) return closePanel(); input.act = true; keyAction('E'); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) act.addEventListener(ev, () => { input.act = false; });
  $('t-fire').addEventListener('pointerdown', e => { e.preventDefault(); keyAction('F'); });
  $('t-dodge').addEventListener('pointerdown', e => { e.preventDefault(); if (!kind) Hero.dodge(joy.x, joy.y); });   // отскок: по джойстику, без него — от угрозы
  $('t-eat').addEventListener('pointerdown', e => { e.preventDefault(); keyAction('Q'); });
  $('t-craft').addEventListener('pointerdown', e => { e.preventDefault(); keyAction('C'); });
  $('craft-btn').addEventListener('click', () => keyAction('C'));
  for (const [id, k] of [['build-btn', 'B'], ['alarm-btn', 'H'], ['idle-btn', '.'], ['sniff-btn', 'V']]) $(id).addEventListener('click', () => keyAction(k));
  $('t-sniff').addEventListener('pointerdown', e => { e.preventDefault(); keyAction('V'); });
  $('t-cmd').addEventListener('pointerdown', e => { e.preventDefault(); setOrder(!orderMode); if (orderMode) tips.did('select'); });

  // после клика по кнопке интерфейса фокус уходит с неё: Enter/Space в игре не нажмут её повторно
  addEventListener('click', e => {
    if (state === 'play' && e.target.closest && e.target.closest('#hud, .corner, #cmdbar, #prompt, .tbtns, #tip') && document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });

  // ---------- сохранения: экран ячеек ----------
  const SLOT_N = { auto: ['retry', 'Авто'], 1: ['save', 'Ячейка 1'], 2: ['save', 'Ячейка 2'], 3: ['save', 'Ячейка 3'] };
  let slotsMode = 'load';
  const hhmm = h => String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor(h % 1 * 60)).padStart(2, '0');
  const when = t => { const d = new Date(t); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  function slotsRender() {
    $('sl-title').innerHTML = slotsMode === 'save' ? `${ic('save', 'l')}Сохранить` : `${ic('load', 'l')}Загрузить`;
    $('sl-list').innerHTML = Saves.SLOTS.map(s => {
      const m = Saves.meta(s), [si, nm] = SLOT_N[s];
      const canSave = slotsMode === 'save' && s !== 'auto', canLoad = slotsMode === 'load' && m && !m.err;
      let sub, badges = '';
      if (!m) sub = 'пусто';
      else if (m.err) { sub = m.err; badges = `<span class="badge danger lamp">не грузится</span>`; }
      else {
        const C = CHAPTERS[m.ch] || CHAPTERS[CHAPTERS.length - 1], E = EPOCHS[m.ep] || EPOCHS[0];
        sub = `день ${m.day} · ${hhmm(m.h)} · глава ${C.num}${m.at ? ' · ' + when(m.at) : ''}${m.from ? ' · перенесён из v' + m.from : ''}`;
        badges = `<span class="badges"><span class="badge" title="День">${ic(m.h >= 7 && m.h < 17 ? 'day' : 'night', 's')}${m.day}</span><span class="badge" title="Эпоха: ${E.n}">${ic('epoch', 's')}${ROMAN[m.ep] || 'I'}</span></span>`;
      }
      const btn = canSave ? `<button class="btn pri" data-save="${s}">Сохранить</button>`
        : canLoad ? `<button class="btn pri" data-load="${s}">Загрузить</button>` : s === 'auto' && m && !m.err ? `<span class="badge info lamp">авто</span>` : '<span></span>';
      return `<div class="row slot ${m && m.err ? 'is-off err' : ''}"><span class="ri">${ic(m && m.err ? 'close' : si)}</span><span class="rn">${nm}<small class="num">${esc(sub)}</small></span>${m && m.err ? '' : badges}${m && m.err ? badges : btn}</div>`;
    }).join('');
  }
  function slotsOpen(mode) { slotsMode = mode; slotsRender(); $('slots').hidden = false; setTimeout(() => { const b = $('sl-list').querySelector('button') || $('sl-back'); b.focus(); }, 30); }
  function slotsClose() { $('slots').hidden = true; menuButtons(); }
  function loadSlot(s) {
    const r = Saves.read(s);
    if (!r.json) { toast(':close: Не загрузить: ' + r.err); slotsRender(); return; }
    const m = Saves.meta(s) || {};
    try { start.msg = `:load: ${SLOT_N[s][1]} · :day:${m.day || '?'}`; start(r.json); }
    catch (e) { toast(':close: Сохранение не читается — ' + e.message); state = 'menu'; ['menu'].forEach(id => $(id).hidden = false); $('hud').hidden = true; $('touch').hidden = true; }
  }
  $('sl-list').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.save) { if (Saves.write(b.dataset.save, SaveGame.snapshot())) { toast(`:save: ${SLOT_N[b.dataset.save][1]} · :day:${G.day}`); Sound.pick(); } slotsRender(); }
    else if (b.dataset.load) loadSlot(b.dataset.load);
  });

  // ---------- настройки ----------
  const DIFF_KEYS = ['easy', 'normal', 'hard'], UI_SIZES = [[0.85, 'S'], [1, 'M'], [1.2, 'L']];
  $('s-diff').innerHTML = DIFF_KEYS.map(k => `<button class="tab" data-v="${k}" title="${Settings.DIFF[k].n}">${Settings.DIFF[k].n}</button>`).join('');
  $('s-ui').innerHTML = UI_SIZES.map(([v, t]) => `<button class="tab" data-v="${v}">${t}</button>`).join('');
  const Q_OPTS = [['auto', 'Авто'], ['high', 'Высокая'], ['low', 'Простая']];
  $('s-q').innerHTML = Q_OPTS.map(([v, t]) => `<button class="tab" data-v="${v}" title="${{ auto: 'Само упростит, если меньше 30 кадров/с', high: 'Высокое', low: 'Упрощённое — для слабых телефонов' }[v]}">${t}</button>`).join('');
  function applyQ() { for (const b of $('s-q').children) b.classList.toggle('on', b.dataset.v === Quality.mode); $('s-q-now').textContent = Quality.level === 'low' ? '· простая' : '· высокая'; }
  applyQ(); addEventListener('sibir-quality', applyQ);
  $('s-q').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { Quality.set(b.dataset.v); applyQ(); } });
  function applySettings() {
    Sound.setVol(Settings.get('music'), Settings.get('sfx'));
    applyScale();
    $('s-music').value = Settings.get('music'); $('s-sfx').value = Settings.get('sfx');
    for (const k of ['music', 'sfx']) $('s-' + k).style.setProperty('--v', Settings.get(k) * 100);
    for (const b of $('s-diff').children) b.classList.toggle('on', b.dataset.v === Settings.get('diff'));
    for (const b of $('s-ui').children) b.classList.toggle('on', +b.dataset.v === Settings.get('ui'));
    for (const k of ['shake', 'edge', 'tips']) { const b = $('s-' + k), on = !!Settings.get(k); b.innerHTML = `<span class="badge lamp ${on ? 'ok' : 'off'}">${on ? 'вкл' : 'выкл'}</span>`; b.setAttribute('aria-pressed', on); }
  }
  Settings.on(applySettings);
  $('s-music').addEventListener('input', e => Settings.set('music', +e.target.value));
  $('s-sfx').addEventListener('input', e => { Settings.set('sfx', +e.target.value); Sound.init(); Sound.pick(); });
  $('s-diff').addEventListener('click', e => { const b = e.target.closest('button'); if (b) Settings.set('diff', b.dataset.v); });
  $('s-ui').addEventListener('click', e => { const b = e.target.closest('button'); if (b) Settings.set('ui', +b.dataset.v); });
  for (const k of ['shake', 'edge', 'tips']) $('s-' + k).addEventListener('click', () => { Settings.set(k, Settings.get(k) ? 0 : 1); if (k === 'tips' && Settings.get(k)) tips.reset(); });
  if (isTouch) $('s-edge-row').hidden = true;

  $('start').onclick = () => start();
  $('continue').onclick = () => { const s = Saves.latest(); if (s) loadSlot(s); };
  $('load-btn').onclick = () => slotsOpen('load');
  $('p-save').onclick = () => slotsOpen('save');
  $('p-load').onclick = () => slotsOpen('load');
  $('sl-back').onclick = () => slotsClose();
  $('o-menu').onclick = () => toMenu();
  $('about-btn').onclick = () => { const a = $('about'); a.hidden = !a.hidden; $('about-btn').setAttribute('aria-expanded', !a.hidden); };
  $('again').onclick = () => start();
  $('o-retry').onclick = () => retry();
  $('resume').onclick = () => pause(false);
  $('pause-btn').onclick = () => pause(true);
  $('snd').onclick = () => { Sound.init(); const on = Sound.toggle(); $('snd').classList.toggle('is-off', !on); $('snd').setAttribute('aria-pressed', !on); };
  function menuButtons() { $('continue').hidden = !Saves.latest(); $('load-btn').hidden = !Saves.any(); }
  menuButtons();
  if (Saves.dropped) setTimeout(() => toast(`:save: Старые сохранения (${Saves.dropped}) стёрты — мир «Сибири 2.0» новый`), 500);
  if (isTouch) { $('keys-hint').hidden = true; }

  // ---------- главный цикл ----------
  function menuWorld() {
    newGame(); G.time = tAt(1, 20.3); G.hut.fuel = 900; G.hut.walls = 1; G.hut.door = 1;
    G.fires.push({ x: HUT.x + 150, y: HUT.y + 150, fuel: 9999 });
    G.p.x = HUT.x + 110; G.p.y = HUT.y + 170; G.p.face = 1;
    G.urk.state = 'hut'; G.urk.x = HUT.x + 200; G.urk.y = HUT.y + 165; G.urk.face = -1;
    G.flags.radioBuilt = 1;
  }
  menuWorld();
  let last = performance.now();
  function loop(t) {
    const iv = (t - last) / 1000, w0 = performance.now();
    const dt = Math.min(0.05, iv); last = t; now = t / 1000;
    syncMove();
    if (state === 'play' && kind) Game.visual(dt); // панель/диалог: игра стоит, мир «дышит»
    const fast = state === 'play' && !kind && Actions.skipFast();
    if (fast) {
      // «До утра»: тот же update() пачкой шагов skipDt, пока хватает кадра (skipMs) — исход по обычным правилам
      const T = TUNE.time;
      for (let i = 0; i < 4000 && state === 'play' && !kind && Actions.skipFast() && performance.now() - w0 < T.skipMs; i++) update(T.skipDt);
    } else if (state === 'play' && !kind) {
      // сон ×sleepX: пачка шагов dt, пока хватает кадра (skipMs) — слабая машина спит чуть медленнее, но не тормозит
      const T = TUNE.time, steps = G.p.sleeping ? T.sleepX : 1;
      for (let i = 0; i < steps && state === 'play' && (i === 0 || (G.p.sleeping && performance.now() - w0 < T.skipMs)); i++) update(dt);
    }
    if (state === 'menu') {
      for (const f of G.fires) if (Math.random() < dt * 7) G.parts.push({ type: 'spark', x: f.x + rnd(-6, 6), y: f.y - 14, vx: rnd(-15, 15), vy: rnd(-80, -40), life: rnd(0.5, 1), max: 1, g: -10 });
      if (Math.random() < dt * 3) G.parts.push({ type: 'smoke', x: HUT.x - 70, y: HUT.y - 150, vx: rnd(-5, 5), vy: rnd(-30, -20), life: 3, max: 3 });
      FX.update(G.parts, dt); // единый слой частиц (js/particles.js)
    }
    frame(dt);
    GFX.render(state === 'play' || state === 'menu' ? dt : 0, state === 'play' ? ctxTarget() : null);
    if (state === 'play') {
      const f = Fire.near(260);
      Sound.frame(dt, { storm: stormOn(), ms: Wind.ms(G.p.x, G.p.y), inside: G.p.inside, night: 1 - daylight(), tension: G.D.tension, warm: G.s.warm,
        fire: f ? clamp(1 - dist(f, G.p) / 260, 0, 1) : (G.p.inside && G.hut.fuel > 0 ? 0.6 : 0), fireAt: f || (G.p.inside && G.hut.fuel > 0 ? SPOT.stove : null) });
    }
    Quality.sample(iv, performance.now() - w0, state === 'play' && !kind && !fast); // промотка грузит кадр нарочно — не мерило качества
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  applyScale();
  return { advance, openMap, openSkip, toast, zone, chapter, card, epoch, hint, isTouch, dialog, note, openCraft, openChest, openStash, openTrade, end, goalTarget: () => Story.goalTarget(), reduced, modal: () => !!kind, get kind() { return kind; },
    // кто в разговоре и чей черёд: пока печатается реплика — говорит собеседник; варианты на экране — герой отвечает с паузами (hero)
    get talk() { return kind === 'dialog' && dlg ? { who: dlg.who, typing: typeN < dlg.t.length, hero: typeN >= dlg.t.length && dlgT % 5 > 0.8 && dlgT % 5 < 3.4, n: typeN, len: dlg.t.length } : null; },
    get panel() { return { tab: panelTab, stash: curStash, trade: tradeWho }; }, closePanel, tips, layout, get scale() { return UI_SCALE.v; }, toMenu,
    focusSel, groupSet, groupGet, setOrder, get orderMode() { return orderMode; }, slotsOpen, loadSlot };
})();
const Tips = UI.tips;
