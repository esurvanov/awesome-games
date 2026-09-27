// Полноэкранные экраны: заставка, анкета, чат перед встречей, итог вечера, пауза.
'use strict';
L.def('ui/screens', () => {
const { ic } = L.use('ui/icons');
const { esc, face, tint, fmt, mixHex } = L.use('ui/dom');
const { Settings, RNG } = L.use('core');

// ───────── заставка ─────────
function title(ui, onStart) {
  ui.screen(`<div class="scr title">
    <div class="neon">Сходка</div>
    <div class="sub">${ic('pin', 's')} Суббота в SushiGO</div>
    <div class="goal">
      <span>${ic('clock', 's')}<b class="num">19:00</b>${ic('next', 's')}<b class="num">01:00</b></span>
      <span class="gl">${ic('wave', 's')}${ic('phone', 's')}${ic('link', 's')}</span>
    </div>
    <button class="btn acc big" data-go>${ic('play')}Играть</button>
  </div>`, 'title');
  ui.S.querySelector('[data-go]').onclick = () => { ui.screen(null); onStart && onStart(); };
}

// ───────── анкета ─────────
// Шаг «Ты»: имя + внешность — всё, что умеет нарисовать 3D-человек (render/looks OPTS). Вкладки Лицо / Волосы / Одежда,
// живое 3D-превью (крошечный отдельный WebGL с render/people, вращается; на «низком» качестве — 2D-портрет).
// Выбор помнится (localStorage). profile.look — полный look; main отдаёт его makeLook через hints.look.
const NAMES_M = ['Саша', 'Дима', 'Лёша', 'Миша', 'Артём', 'Костя', 'Гоша', 'Паша'];
const NAMES_F = ['Аня', 'Лена', 'Маша', 'Катя', 'Ира', 'Света', 'Даша', 'Оля'];
const WSTEPS = [{ icon: 'user', t: 'Ты' }, { icon: 'briefcase', t: 'Работа' }, { icon: 'star', t: 'Интересы' }, { icon: 'handshake', t: 'Ищу · даю' }];
const ME_KEY = 'skhodka-me';
const use = id => { try { return L.use(id); } catch (_) { return null; } };
const LOOK_TABS = [['face', 'smile', 'Лицо'], ['hair', 'hair', 'Волосы'], ['wear', 'shirt', 'Одежда']];
const TIP = { // подсказки при наведении (на экране — только иконки)
  m: 'М', f: 'Ж', thin: 'Худой', avg: 'Средний', stocky: 'Плотный', heavy: 'Крупный',
  short: 'Коротко', buzz: 'Ёжик', messy: 'Лохматые', curly: 'Кудри', long: 'Длинные', bob: 'Каре', ponytail: 'Хвост', bun: 'Пучок',
  balding: 'Залысины', bald: 'Лысый', none: 'Нет', stubble: 'Щетина', full: 'Борода', mustache: 'Усы', goatee: 'Бородка',
  round: 'Круглые', square: 'Квадратные', thin_g: 'Тонкие', cap: 'Кепка', capBack: 'Кепка назад', beanie: 'Шапка', fedora: 'Шляпа',
  tee: 'Футболка', teePrint: 'С принтом', hoodie: 'Худи', sweat: 'Свитшот', polo: 'Поло', check: 'Клетка', stripes: 'Полоска',
  pattern: 'Яркая', blazer: 'Пиджак', vest: 'Жилет', dress: 'Платье', jeans: 'Джинсы', chinos: 'Брюки', shorts: 'Шорты', skirt: 'Юбка',
  legs: 'Колготки', watch: 'Часы', earrings: 'Серьги', lanyard: 'Бейдж',
};
// мини-фигурка: рост (h) и телосложение (w)
const fig = (h, w) => { const H = 22 * h, top = 26 - H, hr = 2.6; return `<svg class="mi" viewBox="0 0 24 28"><circle cx="12" cy="${top + hr}" r="${hr}"/>
  <rect x="${12 - 4.2 * w}" y="${top + hr * 2 + 0.8}" width="${8.4 * w}" height="${H - hr * 2 - 0.8}" rx="${2.6 * w}"/></svg>`; };
const GLASS = {
  round: '<circle cx="7" cy="12" r="4"/><circle cx="17" cy="12" r="4"/><path d="M11 12h2M3 11l-2-1M21 11l2-1"/>',
  square: '<rect x="2.5" y="8.5" width="8" height="6.5" rx="1"/><rect x="13.5" y="8.5" width="8" height="6.5" rx="1"/><path d="M10.5 11h3"/>',
  thin: '<circle cx="7" cy="12" r="3.6"/><circle cx="17" cy="12" r="3.6"/><path d="M10.6 12h2.8"/>',
};
const glassIc = k => `<svg class="mi ln ${k === 'thin' ? 'gold' : ''}" viewBox="0 0 24 24">${GLASS[k]}</svg>`;
// верх: силуэт одежды в своём цвете
function topIc(kind, c, a) {
  const d = '#0006';
  const body = kind === 'dress' ? `<path d="M8.5 3h7l1 6-.5 1 4 12H4l4-12-.5-1z" fill="${c}"/>`
    : kind === 'vest' ? `<path d="M7.5 3.5L12 6l4.5-2.5 1.5 2V21H6V5.5z" fill="${c}"/><path d="M9.5 4.5L12 13l2.5-8.5z" fill="${a}"/>`
    : kind === 'tee' || kind === 'teePrint' || kind === 'polo' ? `<path d="M8 3l4 2.5L16 3l5 3-2 4.5-2.5-1V21h-9V9.5L5 10.5 3 6z" fill="${c}"/>`
    : `<path d="M8 3l4 2.5L16 3l4.5 3 1.5 13-3 .5-1.5-9.5V21h-11v-11L5 19.5l-3-.5L3.5 6z" fill="${c}"/>`;
  const det = {
    teePrint: `<circle cx="12" cy="13" r="3" fill="${a}"/>`,
    polo: `<path d="M9.5 3.8L12 7l-1.3 2.5zM14.5 3.8L12 7l1.3 2.5z" fill="${d}"/>`,
    hoodie: `<path d="M8 3c.5 3 2 4.5 4 4.5S15.5 6 16 3" fill="none" stroke="${d}" stroke-width="1.6"/><path d="M11 8v4M13 8v4" stroke="${a}" stroke-width=".9"/>`,
    sweat: `<path d="M9.5 4.2q2.5 2 5 0" fill="none" stroke="${d}" stroke-width="1.4"/><path d="M7 20h10" stroke="${d}" stroke-width="1.4"/>`,
    check: `<g stroke="${a}" stroke-width="1" opacity=".6"><path d="M7 10h10M6.5 14h11M6.5 18h11M9.5 6v15M14.5 6v15"/></g>`,
    stripes: `<g stroke="${a}" stroke-width="1.2" opacity=".8"><path d="M7 9h10M6.5 12h11M6.5 15h11M6.5 18h11"/></g>`,
    pattern: `<g fill="${a}"><circle cx="9" cy="10" r="1.3"/><circle cx="14.5" cy="13" r="1.3"/><circle cx="10" cy="17" r="1.3"/><circle cx="15" cy="19" r="1"/></g>`,
    blazer: `<path d="M10 4l2 10 2-10z" fill="${a}"/><path d="M10 4l-1.5 5 2 1L12 14M14 4l1.5 5-2 1L12 14" fill="none" stroke="${d}" stroke-width="1"/>`,
    dress: `<path d="M8.7 9.5h6.6" stroke="${d}" stroke-width="1.2"/>`,
  }[kind] || '';
  return `<svg class="mi cl" viewBox="0 0 24 24">${body}${det}</svg>`;
}
function botIc(kind, c) {
  const d = {
    jeans: `<path d="M6 3h12l.5 18h-4.5L12 9l-2 12H5.5z" fill="${c}"/><path d="M6.2 6.5h11.6" stroke="#0005" stroke-width="1"/>`,
    chinos: `<path d="M6.5 3h11l1 18h-4.5L12 9.5 10 21H5.5z" fill="${c}"/><path d="M8.5 8v12M15.5 8v12" stroke="#fff3" stroke-width=".8"/>`,
    shorts: `<path d="M6 3h12l1 9.5h-5.2L12 8l-1.8 4.5H5z" fill="${c}"/><path d="M7 12.5v8M17 12.5v8" stroke="#caa991" stroke-width="2.4"/>`,
    skirt: `<path d="M8 3h8l3.5 11h-15z" fill="${c}"/><path d="M9.5 14v7M14.5 14v7" stroke="#caa991" stroke-width="2.2"/>`,
    legs: `<path d="M8.5 3h7l.3 18h-3L12 10l-.8 11h-3z" fill="${c}"/>`,
  }[kind];
  return `<svg class="mi cl" viewBox="0 0 24 24">${d}</svg>`;
}
const EXTRA_IC = { watch: 'clock', lanyard: 'tag', earrings: null };
const earIc = '<svg class="mi ln gold" viewBox="0 0 24 24"><path d="M9 4v5M15 4v5"/><circle cx="9" cy="13" r="3.2"/><circle cx="15" cy="13" r="3.2"/></svg>';

// крошечный 3D-стенд: один человек, своя сцена и свой WebGL; вращается, тянуть — повернуть
function Preview3D() {
  const { People } = use('render/people') || {};
  if (!People || typeof THREE === 'undefined') return null;
  const cv = document.createElement('canvas'); cv.className = 'pv3';
  let R;
  try { R = new THREE.WebGLRenderer({ canvas: cv, antialias: (window.devicePixelRatio || 1) < 2, alpha: true, powerPreference: 'low-power' }); }
  catch (_) { return null; }
  R.outputColorSpace = THREE.SRGBColorSpace; R.setClearColor(0x000000, 0);
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xffe0c0, 0x3a2028, 2.3));
  const sun = new THREE.DirectionalLight(0xffd0a0, 1.5); sun.position.set(1.2, 2.6, 3); sc.add(sun);
  const rim = new THREE.DirectionalLight(0xff4fa3, 0.8); rim.position.set(-2, 1.5, -2); sc.add(rim);
  const cam = new THREE.PerspectiveCamera(22, 1, 0.1, 30);
  const pp = new People(sc);
  let key = '', raf = 0, last = 0, acc = 0, yaw = 0.45, spin = 0, drag = null, H = 1.75, zoom = 0, zoomT = 0, W0 = 0, H0 = 0;
  const cur = { y: 1, d: 5 };
  cv.onpointerdown = e => { drag = { x: e.clientX, yaw }; cv.setPointerCapture?.(e.pointerId); spin = 3; };
  cv.onpointermove = e => { if (drag) yaw = drag.yaw + (e.clientX - drag.x) * 0.015; };
  cv.onpointerup = cv.onpointercancel = () => { drag = null; };
  function tick(now) {
    raf = 0;
    if (!cv.isConnected) return; // экран закрыт — стенд спит до attach()
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now; acc += dt;
    if (acc < 1 / 30) return; // хватит 30 кадров
    const step = acc; acc = 0;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (w !== W0 || h !== H0) { W0 = w; H0 = h; R.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    if (!drag) { if (spin > 0) spin -= step; else yaw += step * 0.5; }
    zoom += (zoomT - zoom) * Math.min(1, step * 6);
    // кадр: всё тело (одежда) ↔ голова и плечи (лицо, волосы)
    const fy = 0.5 / Math.tan(cam.fov * Math.PI / 360), fit = Math.max(1, 0.62 / cam.aspect);
    const yFull = H * 0.5, dFull = H * 1.12 * fy * fit, yHead = H - 0.4, dHead = fy * Math.max(1, 0.75 / cam.aspect);
    cur.y = yFull + (yHead - yFull) * zoom; cur.d = dFull + (dHead - dFull) * zoom;
    cam.position.set(0, cur.y + 0.08 + 0.1 * (1 - zoom), cur.d); cam.lookAt(0, cur.y, 0);
    pp.root.rotation.y = yaw;
    pp.update(step);
    R.render(sc, cam);
  }
  return {
    el: cv,
    set(look, z) {
      zoomT = z ? 1 : 0;
      const k = JSON.stringify(look); if (k === key) return; key = k;
      const lk = JSON.parse(k); lk.prop = null; H = lk.height || 1.75;
      pp.add('pv', lk); pp.set('pv', { x: 0, z: 0, rot: 0, pose: 'stand', mood: 0.6 });
    },
    attach(host) { host.appendChild(cv); if (!raf) { last = 0; raf = requestAnimationFrame(tick); } },
    dispose() { cancelAnimationFrame(raf); raf = 0; try { pp.remove('pv'); R.dispose(); R.forceContextLoss(); } catch (_) {} cv.remove(); },
  };
}

function profile(ui, onDone) {
  const C = ui.C, rng = new RNG((Date.now() & 0xffff) + 7);
  const LK = use('render/looks');
  const O = LK?.OPTS;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch (_) { return null; } })();
  const fresh = (r = rng, h = {}) => LK ? LK.tidy(LK.makeLook(r, { prop: null, ...h })) : { sex: 'm', hair: 'short', beard: 'stubble', glasses: false, style: 'it' };
  const st = {
    step: 0, tab: 'face', name: typeof saved?.name === 'string' ? saved.name.slice(0, 16) : '',
    look: LK && saved && LK.validLook(saved.look) ? LK.tidy({ ...saved.look, prop: null, hair: { ...saved.look.hair }, top: { ...saved.look.top }, bottom: { ...saved.look.bottom }, hat: saved.look.hat ? { ...saved.look.hat } : null }) : fresh(new RNG(11), { sex: 'm', style: 'it' }), // первый раз — один и тот же облик
    role: null, topics: [], need: null, offer: null,
  };
  const remember = () => { try { localStorage.setItem(ME_KEY, JSON.stringify({ name: st.name, look: st.look })); } catch (_) {} };
  const quality = Settings.get('quality');
  let pv = null, pvTried = false;
  const preview = () => { if (!pvTried && LK && quality !== 'low') { pvTried = true; pv = Preview3D(); } return pv; };
  const done = () => { if (pv) { pv.dispose(); pv = null; } };

  const ok = s => s === 0 ? st.name.trim().length > 0 : s === 1 ? !!st.role : s === 2 ? st.topics.length === 3 : !!(st.need && st.offer);
  const tile = (attr, id, icon, t, on) => `<button class="tile ${on ? 'on' : ''}" data-${attr}="${esc(id)}">${ic(icon || 'dot', 'l')}<span>${esc(t)}</span></button>`;
  // ── выбор внешности ──
  const L0 = () => st.look;
  const cur = k => {
    const l = L0();
    return { sex: l.sex, height: l.height, build: l.build, skin: l.skin, hair: l.hair.style, hairColor: l.hair.color, grey: l.hair.grey || 0,
      beard: l.beard, glasses: l.glasses === 'square' ? true : l.glasses || false, hat: l.hat ? l.hat.kind : null, hatColor: l.hat?.color,
      top: l.top.kind, topColor: l.top.color, bottom: l.bottom.kind, bottomColor: l.bottom.color, shoes: l.shoes,
      watch: !!l.watch, earrings: !!l.earrings, lanyard: !!l.lanyard }[k];
  };
  const btn = (k, v, inner, tip, cls = '') => `<button class="lo ${cls} ${cur(k) === v || (k === 'height' && Math.abs(cur(k) - v) < 0.04) ? 'on' : ''}" data-k="${k}" data-v='${esc(JSON.stringify(v))}' title="${esc(tip || '')}">${inner}</button>`;
  const sw = (k, c, tip = '') => btn(k, c, `<i class="sw" style="background:${c}"></i>`, tip, 'c');
  const tog = (k, inner) => `<button class="lo ${cur(k) ? 'on' : ''}" data-k="${k}" data-v='${JSON.stringify(!cur(k))}' title="${TIP[k]}">${inner}</button>`;
  const alt = patch => { const l = JSON.parse(JSON.stringify(L0())); for (const [k, v] of Object.entries(patch)) if (k === 'hair') Object.assign(l.hair, v); else l[k] = v; return l; };
  const row = (icon, t, inner, cls = '') => `<div class="lrow ${cls}"><span class="ll" title="${t}">${ic(icon, 's')}<em>${t}</em></span><div class="lops">${inner}</div></div>`;
  function lookRows() {
    const l = L0(), f = l.sex === 'f';
    if (!O) return ''; // стенд без render/looks — только имя
    if (st.tab === 'face') return [
      row('user', 'Пол · рост', btn('sex', 'm', ic('male'), 'М') + btn('sex', 'f', ic('female'), 'Ж') + '<b class="lsep"></b>'
        + O.height.map((h, i) => btn('height', h, fig(0.62 + i * 0.095, 1), Math.round(h * 100) + ' см')).join('')),
      row('gym', 'Фигура', O.build.map((b, i) => btn('build', b, fig(0.9, [0.72, 1, 1.28, 1.55][i]), TIP[b])).join('')),
      row('palette', 'Кожа', O.skin.map(c => sw('skin', c)).join('')),
      row('glasses', 'Очки', btn('glasses', false, ic('close', 's'), 'Нет') + btn('glasses', 'round', glassIc('round'), TIP.round)
        + btn('glasses', true, glassIc('square'), TIP.square) + btn('glasses', 'thin', glassIc('thin'), TIP.thin_g)),
      f ? '' : row('beard', 'Борода', O.beard.map(b => btn('beard', b, face(alt({ beard: b, glasses: null, hat: null }), 36, 'me'), TIP[b], 'fc')).join('')),
    ].join('');
    if (st.tab === 'hair') return [
      row('hair', 'Причёска', O.hair.map(h => btn('hair', h, face(alt({ hair: { style: h }, hat: null, glasses: null }), 36, 'me'), TIP[h], 'fc')).join('')),
      row('palette', 'Цвет', O.hairColor.map(c => sw('hairColor', c)).join('')),
      row('spark', 'Седина', O.grey.map(g => btn('grey', g, `<i class="sw" style="background:${mixHex(l.hair.color, '#c9c6c2', g * 0.6)}"></i>`, Math.round(g * 100) + '%', 'c')).join('')),
      row('hat', 'Убор', O.hat.map(h => btn('hat', h, h ? face(alt({ hat: { kind: h, color: l.hat?.color || '#2b2b2b' }, glasses: null }), 36, 'me') : ic('close', 's'), TIP[h || 'none'], h ? 'fc' : '')).join('')
        + (l.hat ? '<b class="lsep"></b>' + O.hatColor.slice(0, 5).map(c => sw('hatColor', c)).join('') : '')),
      l.hat ? row('palette', 'Цвет убора', O.hatColor.slice(5).map(c => sw('hatColor', c)).join(''), 'sub') : '',
    ].join('');
    const tops = O.top.filter(k => f || k !== 'dress'), bots = O.bottom.filter(k => f || (k !== 'skirt' && k !== 'legs'));
    return [
      row('shirt', 'Верх', tops.map(k => btn('top', k, topIc(k, l.top.color, l.top.accent), TIP[k])).join('')),
      row('palette', 'Цвет', O.topColor.map(c => sw('topColor', c)).join('')),
      row('walk', 'Низ', bots.map(k => btn('bottom', k, botIc(k, l.bottom.color), TIP[k])).join('') + '<b class="lsep"></b>'
        + O.bottomColor.slice(0, 3).map(c => sw('bottomColor', c)).join('')),
      row('palette', 'Цвет низа', O.bottomColor.slice(3).map(c => sw('bottomColor', c)).join(''), 'sub'),
      row('boot', 'Обувь', O.shoes.map(c => sw('shoes', c)).join('')),
      row('star', 'Мелочи', tog('watch', ic('clock')) + tog('earrings', earIc) + tog('lanyard', ic('tag'))),
    ].join('');
  }
  function apply(k, v) {
    const l = L0();
    switch (k) {
      case 'sex':
        l.sex = v;
        if (v === 'f') l.beard = 'none';
        else { if (l.top.kind === 'dress') l.top.kind = 'tee'; if (l.bottom.kind === 'skirt' || l.bottom.kind === 'legs') l.bottom = { kind: 'jeans', color: l.bottom.color }; }
        break;
      case 'glasses': l.glasses = v === true ? 'square' : v || null; break;
      case 'hair': l.hair.style = v; break;
      case 'hairColor': l.hair.color = v; break;
      case 'grey': l.hair.grey = v; break;
      case 'hat': l.hat = v ? { kind: v, color: l.hat?.color || '#2b2b2b' } : null; break;
      case 'hatColor': if (l.hat) l.hat.color = v; break;
      case 'top': if (l.top.kind === 'dress' && v !== 'dress' && l.bottom.kind === 'legs') l.bottom = { kind: 'jeans', color: '#2f4a6d' }; l.top.kind = v; break;
      case 'topColor': l.top.color = v; break;
      case 'bottom': if (l.top.kind === 'dress' && v !== 'legs') l.top.kind = 'tee'; l.bottom.kind = v; break;
      case 'bottomColor': l.bottom.color = v; break;
      default: l[k] = v;
    }
    if (LK) LK.tidy(l);
    remember();
  }
  function body() {
    if (st.step === 0) return `
      <div class="lk">
        <div class="lk-pv" id="lk-pv">${pv ? '' : face(st.look, 150, 'me')}</div>
        <div class="lk-side">
          <div class="lk-nm"><label class="field">${ic('user')}<input id="pf-name" maxlength="16" placeholder="Имя" value="${esc(st.name)}" autocomplete="off"></label><button class="btn sq" data-dice title="Случайно">${ic('dice')}</button></div>
          ${O ? `<div class="ltabs">${LOOK_TABS.map(([id, icon, t]) => `<button class="ltab ${st.tab === id ? 'on' : ''}" data-tab="${id}">${ic(icon, 's')}<span>${t}</span></button>`).join('')}</div>` : ''}
        </div>
        <div class="lk-rows">${lookRows()}</div>
      </div>`;
    if (st.step === 1) return `<div class="tiles">${(C.ROLES || []).map(r => tile('role', r.id, r.icon, r.title, st.role === r.id)).join('')}</div>`;
    if (st.step === 2) return `<div class="cnt"><b class="num">${st.topics.length}</b>/3</div><div class="tiles sm">${(C.TOPICS || []).map(t => tile('topic', t.id, t.icon, t.title, st.topics.includes(t.id))).join('')}</div>`;
    return `<div class="two">
      <div><div class="olab big">${ic('search', 's')}Ищу</div><div class="tiles sm col">${(C.NEEDS || []).map(n => tile('need', n.id, n.seek?.icon, n.seek?.title, st.need === n.id)).join('')}</div></div>
      <div><div class="olab big">${ic('gift', 's')}Даю</div><div class="tiles sm col">${(C.NEEDS || []).map(n => tile('offer', n.id, n.offer?.icon, n.offer?.title, st.offer === n.id)).join('')}</div></div>
    </div>`;
  }
  function draw() {
    const y = ui.S.scrollTop || 0;
    if (st.step === 0) preview();
    ui.screen(`<div class="scr whois ${st.step === 0 ? 'w0' : ''}" id="whois">
      <div class="wiz">${WSTEPS.map((s, i) => `<button class="wstep ${i === st.step ? 'cur' : ''} ${i < st.step || (i !== st.step && ok(i)) ? 'done' : ''}" data-goto="${i}">${ic(i < st.step && ok(i) ? 'check' : s.icon, 's')}<span>${s.t}</span></button>`).join('<b class="wline"></b>')}</div>
      <div class="wbody">${body()}</div>
      <div class="wfoot">
        <button class="btn" data-back ${st.step ? '' : 'disabled'}>${ic('back')}</button>
        <button class="btn acc grow" data-next ${ok(st.step) ? '' : 'disabled'}>${st.step < 3 ? 'Дальше' + ic('next') : ic('check') + 'Готово'}</button>
      </div>
    </div>`, 'profile');
    const S = ui.S;
    S.scrollTop = y;
    const host = S.querySelector('#lk-pv');
    if (host && pv) { pv.set(st.look, st.tab !== 'wear'); pv.attach(host); host.insertAdjacentHTML('beforeend', `<span class="lk-mini">${face(st.look, 40, 'me')}</span>`); }
    const nm = S.querySelector('#pf-name');
    if (nm) nm.oninput = () => { st.name = nm.value; S.querySelector('[data-next]').disabled = !ok(0); remember(); };
    S.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { apply(b.dataset.k, JSON.parse(b.dataset.v)); draw(); });
    S.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; draw(); });
    const dice = S.querySelector('[data-dice]');
    if (dice) dice.onclick = () => {
      st.look = fresh();
      st.name = rng.pick(st.look.sex === 'f' ? NAMES_F : NAMES_M);
      remember(); draw();
    };
    S.querySelectorAll('[data-role]').forEach(b => b.onclick = () => { st.role = b.dataset.role; draw(); });
    S.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => {
      const id = b.dataset.topic, i = st.topics.indexOf(id);
      if (i >= 0) st.topics.splice(i, 1); else { if (st.topics.length >= 3) st.topics.shift(); st.topics.push(id); }
      draw();
    });
    S.querySelectorAll('[data-need]').forEach(b => b.onclick = () => { st.need = b.dataset.need; draw(); });
    S.querySelectorAll('[data-offer]').forEach(b => b.onclick = () => { st.offer = b.dataset.offer; draw(); });
    S.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => {
      const g = +b.dataset.goto; for (let i = 0; i < g; i++) if (!ok(i)) return; st.step = g; draw();
    });
    S.querySelector('[data-back]').onclick = () => { if (st.step) { st.step--; draw(); } };
    S.querySelector('[data-next]').onclick = () => {
      if (!ok(st.step)) return;
      if (st.step < 3) { st.step++; draw(); return; }
      remember(); done();
      const look = JSON.parse(JSON.stringify(st.look)); look.prop = null;
      const p = { name: st.name.trim(), look, role: st.role, topics: st.topics.slice(), need: st.need, offer: st.offer };
      ui.profile = p; ui.screen(null); onDone && onDone(p);
    };
  }
  draw();
}

// ───────── чат перед встречей ─────────
function preChat(ui, onGo) {
  const C = ui.C, pre = C.CHAT?.before || C.CHAT?.pre || null;
  const msgs = Array.isArray(pre) && pre.length ? pre.map(m => typeof m === 'string' ? { from: 'Орг', text: m } : m) : [
    { from: 'Орг', text: 'Суббота в Батуми 🌊 Сходка в SushiGO, 19:00. Приходите!', pin: true },
    { from: 'Вика', text: 'Буду к восьми 🙌' },
    { from: 'Тимур', text: 'А футбол там покажут?' },
  ];
  const poll = { yes: 14, maybe: 9, no: 3 }; let vote = null;
  const P = [['yes', 'check', 'Да'], ['maybe', 'question', 'Возможно'], ['no', 'close', 'Нет']];
  function draw() {
    const tot = poll.yes + poll.maybe + poll.no;
    const pin = msgs.find(m => m.pin) || msgs[0];
    ui.screen(`<div class="scr prechat">
      <div class="phone-frame">
        <div class="ph-head"><span class="ava" style="background:#2e7bd6">${ic('users', 's')}</span><div><b>IT Offline Hangouts</b><small class="num">${ic('users', 's')} 312</small></div></div>
        <div class="ph-pin">${ic('pin', 's')}<span>${esc(pin.text)}</span></div>
        <div class="ph-body">
          ${msgs.filter(m => m !== pin).map(m => msg(m)).join('')}
          <div class="poll">
            <div class="poll-q">${ic('chart', 's')}<b>Придёшь?</b><small class="num">${tot}</small></div>
            ${P.map(([k, icon, t]) => `<button class="poll-o ${vote === k ? 'on' : ''}" data-v="${k}">
              <span class="po-l">${ic(icon, 's')}${t}</span><span class="po-bar"><i style="width:${Math.round(poll[k] / tot * 100)}%"></i></span><b class="num">${poll[k]}</b></button>`).join('')}
          </div>
        </div>
        <div class="ph-foot"><button class="btn acc grow big" data-go>${ic('walk')}Иду</button></div>
      </div>
    </div>`, 'prechat');
    ui.S.querySelectorAll('[data-v]').forEach(b => b.onclick = () => {
      if (vote) poll[vote]--; vote = b.dataset.v === vote ? null : b.dataset.v; if (vote) poll[vote]++; draw();
    });
    ui.S.querySelector('[data-go]').onclick = () => { ui.screen(null); onGo && onGo(vote || 'yes'); };
  }
  draw();
}
const msg = (m, me) => `<div class="msg ${me || m.me ? 'me' : ''}">${me || m.me ? '' : `<span class="ava" style="background:${tint(m.from)}">${esc(String(m.from || '?')[0])}</span>`}
  <div class="bub">${me || m.me ? '' : `<b style="color:${tint(m.from)}">${esc(m.from)}</b>`}<span>${esc(m.text)}</span></div></div>`;

// ───────── итог ─────────
const RANKS = [
  [0, 'user', 'Тихий гость'], [4, 'wave', 'Новенький'], [8, 'chat', 'Свой человек'],
  [14, 'spark', 'Душа компании'], [22, 'star', 'Мастер знакомств'], [32, 'crown', 'Легенда SushiGO'],
];
function rankOf(pts) { let r = RANKS[0]; for (const x of RANKS) if (pts >= x[0]) r = x; return { icon: r[1], title: r[2] }; }
function end(ui, s = {}, photo) {
  const n = ui.counts();
  const met = s.met ?? n.met, contacts = s.contacts ?? n.contacts, pairs = s.pairs ?? n.pairs;
  // итог симуляции: photo 0|1, photoN — сколько на снимке; title — { title, icon }; people — знакомые по ступеням
  const onPhoto = s.photo != null ? !!s.photo : !!(s.inPhoto ?? s.photo?.in);
  const inPhoto = s.photoN ?? s.inPhoto ?? 0;
  const rank = s.rank && typeof s.rank === 'object' ? s.rank : s.title && typeof s.title === 'object' ? { title: s.title.title, icon: s.title.icon || 'star' }
    : s.title ? { title: s.title, icon: s.icon || 'star' } : rankOf(met + contacts * 2 + pairs * 3);
  const best = (s.best || s.people || []).filter(b => (b.step ?? 2) >= 2).slice(0, 5);
  const tiles = [['wave', met, 'знакомства', 'c-blue'], ['phone', contacts, 'контакты', 'c-pink'], ['link', pairs, 'пары', 'c-yellow'],
    s.photoEv === false ? ['camera', 0, 'фото не было', 'c-amber'] : ['camera', onPhoto ? inPhoto : '—', onPhoto ? 'на фото' : 'без тебя', 'c-amber']];
  const morning = (s.chat || []).slice(0, 3);
  const share = `Сходка · SushiGO: 👋 ${met} · 📱 ${contacts} · 🔗 ${pairs}${onPhoto ? ` · 📸 ${inPhoto}` : ''} — «${rank.title}»`;
  ui.screen(`<div class="scr end">
    <div class="snap">${photo ? `<img src="${photo}" alt="">` : `<div class="noimg">${ic('image', 'xl')}</div>`}<span class="snap-cap">${ic(s.photoEv === false ? 'moon' : 'camera', 's')}${esc(s.snapCap || 'SushiGO · 01:00')}</span></div>
    <div class="endr">
      <div class="rank">${ic(rank.icon, 'l')}<b>${esc(rank.title)}</b></div>
      <div class="big4">${tiles.map(([icon, v, t, c]) => `<div class="bt ${c}">${ic(icon)}<b class="num">${v}</b><small>${t}</small></div>`).join('')}</div>
      ${best.length ? `<div class="best">${best.map(b => `<span class="bchip">${face(b.look || ui.lookOf(b.id), 28, b.id)}<b>${esc(b.name || '???')}</b></span>`).join('')}</div>` : ''}
      ${morning.length ? `<div class="morning"><span class="mh">${ic('phone', 's')}${ic('sun', 's')}</span>${morning.map(m => `<span class="mm">${m.from ? `<b>${esc(m.from)}</b>` : ''}${esc(m.text)}</span>`).join('')}</div>` : ''}
      <div class="eb">
        <button class="btn acc grow" data-again>${ic('play')}Ещё суббота</button>
        <button class="btn grow" data-share>${ic('share')}Поделиться итогом</button>
      </div>
    </div>
  </div>`, 'end');
  ui.S.querySelector('[data-again]').onclick = () => { ui.bus.emit('again'); };
  ui.S.querySelector('[data-share]').onclick = async e => {
    const b = e.currentTarget; let ok = false;
    try { await navigator.clipboard.writeText(share); ok = true; } catch (_) {
      try { const t = document.createElement('textarea'); t.value = share; document.body.appendChild(t); t.select(); ok = document.execCommand('copy'); t.remove(); } catch (__) {}
    }
    b.innerHTML = ok ? ic('check') + 'Скопировано' : ic('copy') + 'Не вышло';
    ui.bus.emit('share', share);
  };
  return share;
}

// ───────── пауза ─────────
const QUAL = [['auto', 'Авто'], ['low', 'Низк.'], ['medium', 'Сред.'], ['high', 'Выс.']];
function pause(ui) {
  const q = Settings.get('quality') || 'auto', snd = +Settings.get('sound');
  ui.M.innerHTML = `<div class="menu plate">
    <div class="m-h">${ic('pause')}<b>Пауза</b></div>
    <button class="btn acc big grow" data-resume>${ic('play')}Продолжить</button>
    <div class="m-row"><span class="olab">${ic('gear', 's')}Графика</span><div class="seg">${QUAL.map(([k, t]) => `<button class="${q === k ? 'on' : ''}" data-q="${k}">${t}</button>`).join('')}</div></div>
    <div class="m-row"><span class="olab">${ic(snd ? 'sound' : 'mute', 's')}Звук</span><div class="seg">
      <button class="${snd ? 'on' : ''}" data-snd="1">${ic('sound', 's')}Вкл</button><button class="${snd ? '' : 'on'}" data-snd="0">${ic('mute', 's')}Выкл</button></div></div>
  </div>`;
  ui.M.hidden = false;
  ui.M.querySelector('[data-resume]').onclick = () => ui.setPaused(false);
  ui.M.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { Settings.set('quality', b.dataset.q); ui.bus.emit('quality', b.dataset.q); pause(ui); });
  ui.M.querySelectorAll('[data-snd]').forEach(b => b.onclick = () => { Settings.set('sound', +b.dataset.snd); ui.bus.emit('sound', +b.dataset.snd); pause(ui); });
}

return { title, profile, preChat, end, pause, msg, rankOf };
});
