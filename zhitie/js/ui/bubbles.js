// Пузыри над симами (речь — с хвостиком, мысль — облачко) и тосты уведомлений.
import { h, esc, hash01 } from './dom.js';
import { iconHtml, ico } from './icons.js';

const BUBBLE_SEC = 2.6;   // сколько висит пузырь, реальные секунды
const TOAST_SEC = 6;      // сколько висит тост
const DEDUP_MS = 1500;    // окно склейки одинаковых тостов
const HEAD_Y = 3.0;       // высота над полом, м: выше нимба выбранного сима
const BUBBLE_LIFT = 1.2; // над макушкой, м — нимб (~0.4 м) остаётся виден
const LEVEL_H = 3;        // высота этажа, м (CONTRACT §2)

export function createBubbles(ctx) {
  const { state, bus, api } = ctx;
  const layer = h('div.zh-bubbles');
  const toasts = h('div.zh-toasts', { 'data-ui': 'toasts' });
  ctx.root.append(layer, toasts);
  const live = new Map(); // simId → {el, t, kind}
  const seenState = new Map(); // simId → ключ sim.bubble, чтобы не повторять

  function show(simId, icon, kind) {
    const sim = state.sims.find(s => s.id === simId);
    if (!sim || sim.atWork) return; // на работе сима не видно — и пузыря нет
    live.get(simId)?.el.remove();
    const el = h('div.zh-bubble.' + kind, { html: `<span class="bi">${iconHtml(icon, 26)}</span>${kind === 'think' ? '<i class="d1"></i><i class="d2"></i>' : ''}` });
    layer.append(el);
    live.set(simId, { el, t: BUBBLE_SEC, kind });
    place(sim, el);
    return sim;
  }

  bus.on('sim:speak', ({ simId, icon, withId }) => {
    const sim = show(simId, icon, withId != null ? 'talk' : 'think');
    if (!sim || state.mode !== 'live') return;
    // голос: тон — от id сима; панорама — по положению на экране
    const p = safePos(sim);
    ctx.audio.speak(sim, { h01: hash01(sim.id), pan: p ? (p.x / innerWidth) * 2 - 1 : 0, mood: api.sim.mood?.(sim) ?? 0 });
  });

  bus.on('notify', ({ text, icon, simId }) => toast(text, icon, simId));

  // cls: 'death' | 'joy' | 'alert'; sec — сколько висит
  // одно событие — один тост: Мозг (notify) и Интерфейс (npc:arrive, sim:died…) могут сообщить одно и то же.
  // Та же иконка за DEDUP_MS → не дублируем; особый вид (death/joy/alert) важнее обычного.
  const recent = []; // {icon, t, el, cls}
  function toast(text, icon = 'bell', simId, cls = '', sec = TOAST_SEC) {
    const now = performance.now();
    while (recent.length && now - recent[0].t > DEDUP_MS) recent.shift();
    const dup = recent.find(r => r.icon === icon && r.el.isConnected);
    if (dup) {
      if (cls && !dup.cls) { dup.el.classList.add(cls); dup.el.querySelector('.tt').textContent = text; dup.cls = cls; }
      return dup.el;
    }
    while (toasts.children.length >= 4) toasts.firstChild.remove();
    const el = h('div.zh-toast' + (cls ? '.' + cls : ''), { html: `<span class="ti">${iconHtml(icon, 20)}</span><span class="tt">${esc(text)}</span><button class="tx" title="Закрыть">${ico('close', 12)}</button>` });
    el.querySelector('.tx').addEventListener('click', e => { e.stopPropagation(); el.remove(); });
    if (simId != null) {
      el.classList.add('link');
      el.addEventListener('click', () => {
        const s = state.sims.find(x => x.id === simId);
        if (s) { ctx.select(s.id, false); api.render.focus?.(s.x, s.y); }
      });
    }
    toasts.append(el);
    recent.push({ icon, t: now, el, cls });
    if (!cls) ctx.audio.sfx('chime');
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, sec * 1000);
  }

  // над головой: точная точка от Рендера (simScreenPos), иначе — по росту
  function safePos(sim) {
    try {
      const p = api.render.simScreenPos?.(sim.id, BUBBLE_LIFT) || api.render.screenPos(sim.x, (sim.level || 0) * LEVEL_H + HEAD_Y, sim.y);
      return p && p.visible !== false ? p : null;
    } catch { return null; }
  }
  function place(sim, el) {
    const p = safePos(sim);
    if (!p) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
  }

  function update(dt) {
    // мысли из состояния: Мозг может ставить sim.bubble без события
    for (const s of state.sims) {
      const key = s.bubble ? `${s.bubble.icon}|${s.bubble.until}` : '';
      if (key && seenState.get(s.id) !== key && !live.has(s.id)) show(s.id, s.bubble.icon, 'think');
      seenState.set(s.id, key);
    }
    for (const [id, b] of live) {
      b.t -= dt;
      const sim = state.sims.find(s => s.id === id);
      if (!sim || sim.atWork || b.t <= 0 || state.mode !== 'live') { b.el.remove(); live.delete(id); continue; }
      place(sim, b.el);
      if (b.t < 0.5) b.el.style.opacity = String(b.t / 0.5);
    }
  }
  return { update, toast };
}
