// Вкладки «Дом» (стоимость, оценки комнат, счета) и «Настройки» (громкость, прокрутка краем, автосохранение).
import { h, setText, setStyle, keyedList, motiveColor, money, clamp, toggle } from './dom.js';
import { ico } from './icons.js';
import { byId, WALLS, FLOORS } from '../../data/catalog.js';

const ROOM_ICON = { kitchen: '🍳', bathroom: '🚿', bedroom: '🛏️', living: '🛋️', study: '💻' };
const ROOM_NAME = { kitchen: 'Кухня', bathroom: 'Ванная', bedroom: 'Спальня', living: 'Гостиная', study: 'Кабинет' };
const RECALC_SEC = 0.5; // оценки комнат пересчитываем не чаще

// Стоимость дома: предметы по цене + стены и полы по цене материала
export function houseValue(state) {
  let v = 0;
  for (const o of state.objects) v += byId[o.def]?.price || 0;
  const wp = new Map(WALLS.map(w => [w.id, w.price])), fp = new Map(FLOORS.map(f => [f.id, f.price]));
  for (const L of state.lot.levels) {
    for (const t of L.wallH) if (t) v += wp.get(t) || 0;
    for (const t of L.wallV) if (t) v += wp.get(t) || 0;
    for (const t of L.floor) if (t) v += fp.get(t) || 0;
  }
  return v;
}

// дневная зарплата жителя (CAREERS у Мозга)
function careerPay(ctx, s) {
  const t = ctx.api.sim.CAREERS?.[s.career.track];
  return (t?.levels || [])[s.career.level - 1]?.pay ?? 0;
}

export function createHousePane(ctx) {
  const { state, api } = ctx;
  const val = h('span.big'), objs = h('span.sub'), billsBox = h('div.hbills');
  const fundsEl = h('span.hm-f'), incEl = h('span.hm-i'), billEl = h('span.hm-b');
  const rooms = h('div.hrooms');
  const el = h('div.pane.house', {}, h('div.hv', {}, h('span.sub', { html: `${ico('room', 13)} стоимость` }), val, objs,
    h('div.hmoney', { title: 'Деньги семьи · доход в день · счета' }, fundsEl, incEl, billEl), billsBox), rooms);
  const roomList = keyedList(rooms, r => r.id, r => h('div.hroom', {}, h('span.re'), h('span.ra'), h('span.bar.center', {}, h('i')), h('span.rv')), (e, r) => {
    const [ic, name, bar, num] = e.children;
    setText(ic, r.icon); setText(name, r.name); e.title = `${r.name} · ${r.area} м² · оценка ${Math.round(r.score)}`;
    const v = clamp(r.score, -100, 100), f = bar.firstChild;
    setStyle(f, 'left', v >= 0 ? '50%' : `${50 + v / 2}%`); setStyle(f, 'width', `${Math.abs(v) / 2}%`); setStyle(f, 'background', motiveColor(v));
    setText(num, Math.round(v));
  });
  const billList = keyedList(billsBox, b => b.id, () => h('div.hbill', {}, h('span'), h('span')), (e, b) => {
    setText(e.firstChild, `🧾 д.${(b.day ?? 0) + 1}`); setText(e.lastChild, money(b.amount || 0));
  });
  let t = 0;

  function rows() {
    const list = (state.lot.rooms || []).filter(r => !r.outside && r.id !== 0);
    // тип комнаты — по большинству предметов (поле room каталога)
    const kinds = new Map();
    if (api.world.roomAt) for (const o of state.objects) {
      const k = byId[o.def]?.room;
      if (!ROOM_ICON[k]) continue;
      const rid = api.world.roomAt(state, o.x, o.y, o.level || 0);
      const m = kinds.get(rid) || {}; m[k] = (m[k] || 0) + 1; kinds.set(rid, m);
    }
    return list.map(r => {
      const m = kinds.get(r.id) || {};
      const k = Object.keys(m).sort((a, b) => m[b] - m[a])[0];
      return { id: r.id, area: r.area ?? '?', icon: ROOM_ICON[k] || '▫️', name: ROOM_NAME[k] || `Комната ${r.id}`, score: api.world.roomScore ? api.world.roomScore(state, r.id) : 0 };
    }).sort((a, b) => b.score - a.score);
  }

  return {
    el,
    update(dt) {
      t -= dt;
      if (t > 0) return;
      t = RECALC_SEC;
      setText(val, money(houseValue(state)));
      // семейный бюджет: деньги, зарплаты в день, неоплаченные счета
      const inc = ctx.household().reduce((a, s) => a + (s.career ? (careerPay(ctx, s) || 0) : 0), 0);
      const due = (state.household.bills || []).reduce((a, b) => a + (b.amount || 0), 0);
      setText(fundsEl, `💰 ${money(state.household.money)}`); setText(incEl, `💼 +${money(inc)}/д`); setText(billEl, due ? `🧾 −${money(due)}` : '');
      setText(objs, `📦 ${state.objects.length} предм.`);
      billList(state.household.bills || []);
      roomList(rows());
    },
  };
}

export function createOptionsPane(ctx) {
  const { audio } = ctx;
  const slider = (icon, label, get, set) => {
    const inp = h('input', { type: 'range', min: 0, max: 100, value: Math.round(get() * 100), 'aria-label': label });
    inp.addEventListener('input', () => set(inp.value / 100));
    inp.addEventListener('change', () => audio.sfx('click'));
    return h('label.opt', {}, h('span.ni', { html: ico(icon, 14) }), h('span', { text: label }), inp);
  };
  const sw = (icon, label, key) => {
    const b = h('button.zh-sw2', { title: label, 'aria-label': label, 'data-opt': key });
    const sync = () => toggle(b, 'on', !!ctx.settings[key]);
    b.addEventListener('click', () => { ctx.setSetting(key, !ctx.settings[key]); sync(); audio.sfx('click'); });
    sync();
    return h('div.opt.row', {}, h('span.ni', { html: ico(icon, 14) }), h('span', { text: label }), b);
  };
  const musicSw = h('button.zh-sw2', { title: 'Музыка', 'data-opt': 'music' });
  const syncM = () => toggle(musicSw, 'on', audio.musicOn);
  musicSw.addEventListener('click', () => { audio.toggleMusic(); syncM(); ctx.panelSyncMusic?.(); });
  syncM();
  const el = h('div.pane.opts', {},
    slider('music', 'Музыка', () => audio.musicVol, v => audio.setMusicVol(v)),
    slider('sfx', 'Звуки', () => audio.sfxVol, v => audio.setSfxVol(v)),
    h('div.opt.row', {}, h('span.ni', { html: ico('music', 14) }), h('span', { text: 'Музыка вкл.' }), musicSw),
    sw('edge', 'Прокрутка краем', 'edgeScroll'),
    sw('save', 'Автосохранение', 'autosave'),
  );
  return { el, syncMusic: syncM };
}
