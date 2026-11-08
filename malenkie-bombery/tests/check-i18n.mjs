// Проверка переводов игры: у каждого языка есть все строки словаря и все 18 наград,
// а каждая русская строка из разметки и вызовов tr('…') есть в словаре. Запуск: node tests/check-i18n.mjs
import { readFileSync } from 'node:fs'
const s = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const a = s.indexOf('const DICT = {'), b = s.indexOf('function pickLang')
const { DICT, ACHL } = new Function(s.slice(a, b) + ';return {DICT,ACHL}')()
const errs = []
const base = Object.keys(DICT.en)
for (const l of Object.keys(DICT)) {
  for (const k of base) if (!DICT[l][k]) errs.push(`${l}: нет перевода «${k}»`)
  for (const k of Object.keys(DICT[l])) if (!(k in DICT.en)) errs.push(`${l}: лишний ключ «${k}»`)
}
const ids = [...s.matchAll(/\{ id: '(\w+)', ic:/g)].map((m) => m[1])
for (const l of Object.keys(ACHL)) for (const id of ids) { const v = ACHL[l][id]; if (!v || !v[0] || !v[1]) errs.push(`${l}: нет награды ${id}`) }
const lit = new Set()
for (const m of s.matchAll(/tr\('([^']+)'\)/g)) lit.add(m[1])
for (const m of s.matchAll(/name: '([А-Яа-я][^']*)'/g)) lit.add(m[1])
for (const m of s.matchAll(/\['(.)', '([А-Яа-я]+)'\]/g)) lit.add(m[2])
const html = s.slice(s.indexOf('<body>'), s.indexOf('<script>\n'))
for (const m of html.matchAll(/>([^<>]*[А-Яа-яЁё][^<>]*)</g)) lit.add(m[1].trim())
for (const m of html.matchAll(/(?:title|placeholder|aria-label)="([^"]*[А-Яа-яЁё][^"]*)"/g)) lit.add(m[1])
lit.delete('Взорвался') // заглушка: текст проигрыша всегда подставляется из LOSE
for (const x of lit) if (x && !(x in DICT.en)) errs.push(`нет в словаре: «${x}»`)
console.log(errs.length ? errs.join('\n') : `переводы полны: ${Object.keys(DICT).length} языков кроме русского, ${ids.length} наград`)
process.exit(errs.length ? 1 : 0)
