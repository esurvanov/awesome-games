// Мелкие DOM-помощники. Правило: DOM строим один раз, потом только меняем значения
// (урок «Сибири»: перестройка панели по таймеру теряла ~30% кликов).

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// h('div.cls1.cls2', {attrs}, ...children) — children: Node | string
export function h(tag, attrs = {}, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

// Обновления «на месте» — пишем в DOM только если значение изменилось
export const setText = (el, v) => { v = String(v); if (el.textContent !== v) el.textContent = v; };
export const setHtml = (el, v) => { if (el._h !== v) { el._h = v; el.innerHTML = v; } };
export const setStyle = (el, k, v) => { if (el.style[k] !== v) el.style[k] = v; };
export const setVar = (el, k, v) => { if (el._v?.[k] !== v) { (el._v ||= {})[k] = v; el.style.setProperty(k, v); } };
export const toggle = (el, cls, on) => { if (el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on); };
export const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };

// Ключевой список: добавляет/удаляет только изменившиеся элементы, существующие не трогает.
// make(item) → el; upd(el, item) — обновить значения на месте.
export function keyedList(box, keyOf, make, upd = () => {}) {
  const map = new Map();
  return items => {
    const seen = new Set();
    let prev = null;
    for (const it of items) {
      const k = keyOf(it);
      seen.add(k);
      let el = map.get(k);
      if (!el) { el = make(it); map.set(k, el); }
      upd(el, it);
      const want = prev ? prev.nextSibling : box.firstChild;
      if (want !== el) box.insertBefore(el, want);
      prev = el;
    }
    for (const [k, el] of map) if (!seen.has(k)) { el.remove(); map.delete(k); }
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// −100..100 → цвет полоски: красный → жёлтый → зелёный
export function motiveColor(v) {
  const t = clamp((v + 100) / 200, 0, 1);
  const hue = Math.round(t * 125); // 0 красный … 125 зелёный
  return `hsl(${hue} 72% ${t < 0.5 ? 52 : 45}%)`;
}

// Игровые минуты → день недели и HH:MM (день 0 — понедельник)
export const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export function clockOf(minutes) {
  const m = Math.floor(minutes), day = Math.floor(m / 1440), mm = m % 1440;
  return { day, dow: DAYS[day % 7], hh: String(Math.floor(mm / 60)).padStart(2, '0'), mi: String(mm % 60).padStart(2, '0') };
}

// § с разделителями тысяч (узкий пробел)
export const money = n => '§' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// Детерминированный хэш строки/числа → 0..1 (тон голоса, мелкие вариации)
export function hash01(v) {
  let x = 2166136261;
  for (const c of String(v)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); }
  return ((x >>> 0) % 10007) / 10007;
}
