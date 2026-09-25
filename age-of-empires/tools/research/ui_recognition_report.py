#!/usr/bin/env python3
"""Сводка слепого теста значков → таблицы markdown (stdout) и scores.json для ui_compare.py worst.
  .venv/bin/python tools/research/ui_recognition_report.py > /tmp/tables.md
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui_recognition_data import ROWS, QUAL, R_UNIT, R_BPIC, R_CMD, R_SHIP  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
CATS = [('res', '💰 Ресурсы и население'), ('age', '🛡 Эпохи'), ('top', '🔝 Кнопки верха'), ('mm', '🗺 Мини-карта'),
        ('stat', '📊 Характеристики'), ('bld', '🏠 Кнопки зданий'), ('unit', '⚔️ Обучение юнитов'),
        ('tech', '📜 Технологии'), ('cmd', '🎯 Команды'), ('port', '👤 Портреты юнитов'),
        ('portb', '🏰 Портреты зданий'), ('cur', '🖱 Курсоры')]
NO_REF = {'tech__barracks.supplies'}   # нет картинки DE для листа сравнения
VIS = {'top': 9, 'res': 9, 'bld': 8, 'unit': 8, 'cmd': 8, 'port': 7, 'portb': 6, 'age': 6, 'tech': 5, 'stat': 5,
       'mm': 4, 'cur': 3}


def verdict(blind, subj):
    if subj == 'F':
        return '❌'
    if blind == '✅' and subj in ('✅', '⚠️'):
        return '✅'
    if blind == '❌' and subj == '❌':
        return '❌'
    return '⚠️'


def severity(blind, subj):
    if subj == 'F':
        return 9                     # «ложный друг» хуже всего: игрок уверенно ошибается
    b = {'✅': 0, '⚠️': 1, '❌': 2}[blind]
    s = {'✅': 0, '⚠️': 1, '❌': 2, 'F': 4}[subj]
    return b * 2 + s


def rows():
    out = []
    for r in ROWS:
        key, name, blind, subj, guess, de, bad, fix, cost = r
        cat = 'cmd' if key == 'unit__treb.trebuchet_up' else key.split('__')[0]
        out.append(dict(file=key + '.png', key=key, cat=cat, name=name, blind=blind, subj=subj, guess=guess, de=de,
                        bad=bad, fix=fix, cost=cost, verdict=verdict(blind, subj), sev=severity(blind, subj)))
    return out


def pct(n, d):
    return f'{round(100 * n / d)}%' if d else '—'


def bar(ok, part, bad, width=10):
    tot = ok + part + bad
    a = round(width * ok / tot)
    b = round(width * part / tot)
    return '█' * a + '▒' * b + '·' * (width - a - b)


def main():
    rs = rows()
    blind_files = set(json.load(open(os.path.join(ROOT, 'shots/research_ui/blind/_key.json'))).values())
    missing = blind_files - {r['file'] for r in rs}
    if missing:
        print('НЕТ ДАННЫХ:', sorted(missing), file=sys.stderr)
    # худшие: тяжесть, затем заметность
    ranked = sorted(rs, key=lambda r: (-r['sev'], -VIS[r['cat']], r['cat']))
    worst, per = [], {}
    for r in ranked:                 # не больше 6 из одной категории — чтобы лист был разнообразным
        if r['key'] in NO_REF:
            continue
        if per.get(r['cat'], 0) < 6:
            worst.append(r)
            per[r['cat']] = per.get(r['cat'], 0) + 1
    for i, r in enumerate(worst[:30], 1):
        r['worst_rank'] = i
    json.dump(rs, open(os.path.join(ROOT, 'shots/research_ui/scores.json'), 'w'), ensure_ascii=False, indent=1)

    p = print
    tot = {v: sum(1 for r in rs if r['verdict'] == v) for v in ('✅', '⚠️', '❌')}
    n = len(rs)
    nq = len(QUAL)
    tq = {v: sum(1 for q in QUAL if q[3] == v) for v in ('✅', '⚠️', '❌')}
    p('## 📊 Итог\n')
    p('| | ✅ узнаётся | ⚠️ с трудом | ❌ не узнаётся | 🚫 | всего |')
    p('|---|:-:|:-:|:-:|:-:|:-:|')
    p(f"| Значки (слепой тест) | {tot['✅']} | {tot['⚠️']} | {tot['❌']} | 0 | {n} |")
    p(f"| Панели, шрифты, состояния | {tq['✅']} | {tq['⚠️']} | {tq['❌']} | 0 | {nq} |")
    p(f"| **Всего** | **{tot['✅'] + tq['✅']}** | **{tot['⚠️'] + tq['⚠️']}** | **{tot['❌'] + tq['❌']}** | **0** | "
      f"**{n + nq}** |\n")
    bl = {v: sum(1 for r in rs if r['blind'] == v) for v in ('✅', '⚠️', '❌')}
    sj = {v: sum(1 for r in rs if r['subj'] == v) for v in ('✅', '⚠️', '❌', 'F')}
    p(f"Слепо угадано точно **{bl['✅']}/{n} ({pct(bl['✅'], n)})**, ещё {bl['⚠️']} — «та же семья». "
      f"Сюжет как в DE: {sj['✅']} ✅ · {sj['⚠️']} ⚠️ другая подача · {sj['❌']} ❌ другой предмет · "
      f"**{sj['F']} «ложных друзей»** (наш рисунок в DE значит другое).\n")
    p('## 🎯 Узнаваемость по категориям\n')
    p('| Категория | n | слепо ✅ | сюжет DE ✅/⚠️ | вердикт ✅ · ⚠️ · ❌ | |')
    p('|---|:-:|:-:|:-:|:-:|---|')
    for c, title in CATS:
        cr = [r for r in rs if r['cat'] == c]
        if not cr:
            continue
        k = len(cr)
        b = sum(1 for r in cr if r['blind'] == '✅')
        s = sum(1 for r in cr if r['subj'] in ('✅', '⚠️'))
        v = [sum(1 for r in cr if r['verdict'] == x) for x in ('✅', '⚠️', '❌')]
        p(f'| {title} | {k} | {pct(b, k)} | {pct(s, k)} | {v[0]} · {v[1]} · {v[2]} | `{bar(*v)}` |')
    p()
    p('## 🔥 Топ-15 самых непривычных\n')
    p('| # | Элемент | У нас | В DE | Слепо подумал | Как исправить | Цена |')
    p('|:-:|---|---|---|---|---|:-:|')
    for r in worst[:15]:
        mark = ' 🔁' if r['subj'] == 'F' else ''
        fx = r['fix'].replace(R_UNIT, 'рендер нашей модели в кадре DE').replace(R_BPIC, 'рендер здания на небе')
        fx = fx.replace(R_CMD, 'фигурка воина в позе приказа').replace(R_SHIP, 'рендер своего корабля')
        p(f"| {r['worst_rank']} | {r['name']}{mark} | {r['bad']} | {r['de']} | {r['guess']} | {fx} | {r['cost']} |")
    p('\n🔁 — «ложный друг»: игрок DE увидит другой предмет.\n')
    p('## 📋 Все кванты\n')
    p('Слепо: ✅ точно · ⚠️ та же семья · ❌ мимо. Сюжет: как в DE ✅ · ⚠️ другая подача · ❌ другой предмет · '
      '🔁 ложный друг. Вырезки: `shots/research_ui/items/<ключ>.png`, пары «наш | DE»: `shots/research_ui/pairs_*.png`.\n')
    q = 0
    for c, title in CATS:
        cr = [r for r in rs if r['cat'] == c]
        if not cr:
            continue
        p(f'### {title}\n')
        p('| # | Элемент | Эталон DE | Слепо | Сюжет | Вердикт | Что сбивает | Как исправить | Цена |')
        p('|:-:|---|---|:-:|:-:|:-:|---|---|:-:|')
        for r in cr:
            q += 1
            sj_ = '🔁' if r['subj'] == 'F' else r['subj']
            p(f"| {q} | {r['name']} | {r['de']} | {r['blind']} {r['guess']} | {sj_} | {r['verdict']} | {r['bad']} | "
              f"{r['fix']} | {r['cost']} |")
        p()
    p('### 🧱 Панели, шрифты, состояния кнопок\n')
    p('| # | Элемент | Эталон DE | У нас | Вердикт | Что сбивает | Как исправить | Цена |')
    p('|:-:|---|---|---|:-:|---|---|:-:|')
    for e in QUAL:
        q += 1
        p(f'| {q} | ' + ' | '.join(e) + ' |')
    p()
    print(f'кванты: {q}', file=sys.stderr)


if __name__ == '__main__':
    main()
