'use strict';
// Исполнитель заданий: читает QUESTS (js/content/quests.js) — стадия, узел разговора, сдача, награда.
// Новое задание не требует правок здесь: запись в QUESTS + правило {quest: id} в talk персонажа-заказчика.
const Quests = (() => {
  // поле задания: функция g → значение или путь в G ('flags.x')
  const val = (q, k, def) => { const v = q[k]; return v === undefined ? def : typeof v === 'function' ? v(G) : Story.get(v); };
  // стадия: offer — предложить; advice — взято, ждём (для give — просьба с кнопкой «отдать»); success — сдать; null — нечего сказать
  function stage(id) {
    const q = QUESTS[id];
    if (q.goal === 'give') {
      if (!val(q, 'started')) return val(q, 'available', true) ? 'offer' : null;
      return val(q, 'done') ? null : 'advice';
    }
    if (q.goal === 'find' && !q.d) return null;
    if (val(q, 'accepted') && val(q, 'cond', q.goal === 'find' ? val(q, 'count', 0) >= q.n : false) && !val(q, 'done')) return 'success';
    if (val(q, 'available', true) && !val(q, 'accepted') && !val(q, 'started')) return 'offer';
    return null;
  }
  // узел диалога для текущей стадии (или null)
  function node(id) {
    const q = QUESTS[id], s = stage(id);
    if (!s) return null;
    if (s === 'offer') return DIALOG[q.d.offer];
    if (s === 'success') return DIALOG[q.d.success];
    if (q.goal === 'give') return { who: q.giver, t: q.d.ask, opts: [Inv.cnt(q.item, q.wc) >= q.n ? { t: q.d.give, next: q.d.success } : { t: q.d.notYet }] };
    return q.d.advice ? DIALOG[q.d.advice] : null;
  }
  // сдать: забрать принесённое, отметить, выдать награду
  function complete(id) {
    const q = QUESTS[id];
    if (q.goal === 'give') Inv.take(q.item, q.n, q.wc);
    if (typeof q.done === 'string') Story.set(q.done, 1);
    if (q.reward) Story.run(q.reward);
  }
  // act узла диалога, принадлежащий заданию (true — обработан)
  function act(a) {
    for (const id in QUESTS) {
      const x = QUESTS[id].acts && QUESTS[id].acts[a];
      if (!x) continue;
      if (x === 'complete') complete(id); else Story.run(x);
      return true;
    }
    return false;
  }
  // «find»: счётчик дошёл до n — награда (зовётся там, где счётчик растёт)
  function check(id) {
    const q = QUESTS[id];
    if (val(q, 'count', 0) === q.n && !val(q, 'done', false)) complete(id);
  }
  // взятые и не сданные (для журнала/компаса)
  const active = () => Object.keys(QUESTS).filter(id => { const q = QUESTS[id]; return val(q, 'accepted', false) && !val(q, 'done', false); });
  return { stage, node, complete, act, check, active };
})();
