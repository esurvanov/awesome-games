// Выгрузка Telegram (result.json, сотни МБ) → обезличенный messages.jsonl + статистика по месяцам.
// Файл больше предела строки V8, поэтому читаем построчно и разбираем каждое сообщение отдельно.
//
//   node tools/tg-extract.mjs "<путь к result.json>" [выходная папка, по умолчанию .cache/tg]
//
// В выход не попадают имена и id авторов: только короткий хеш автора (чтобы видеть нити разговора),
// дата, ответ-на, текст, число реакций.
import { createReadStream, mkdirSync, createWriteStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';

const [src, out = '.cache/tg'] = process.argv.slice(2);
if (!src) { console.error('нужен путь к result.json'); process.exit(1); }
mkdirSync(out, { recursive: true });

const salt = String(Math.random());
const who = id => id ? createHash('sha1').update(salt + id).digest('hex').slice(0, 8) : null;
const flat = t => typeof t === 'string' ? t : (t || []).map(p => typeof p === 'string' ? p : p.text).join('');

const jsonl = createWriteStream(`${out}/messages.jsonl`);
const months = {};
let buf = null, n = 0, bad = 0;

const rl = createInterface({ input: createReadStream(src, { encoding: 'utf8' }), crlfDelay: Infinity });
for await (const line of rl) {
  if (buf === null) { if (line === '  {') buf = ['{']; continue; }
  if (line === '  }' || line === '  },') {
    buf.push('}');
    try {
      const m = JSON.parse(buf.join('\n'));
      const text = flat(m.text).trim();
      const mon = (m.date || '').slice(0, 7);
      const s = months[mon] ||= { all: 0, text: 0 };
      s.all++;
      if (m.type === 'message' && text) {
        s.text++;
        const reacts = (m.reactions || []).reduce((a, r) => a + (r.count || 0), 0);
        jsonl.write(JSON.stringify({ id: m.id, d: m.date, a: who(m.from_id), r: m.reply_to_message_id || null, t: text, re: reacts || undefined, fw: m.forwarded_from ? 1 : undefined }) + '\n');
        n++;
      }
    } catch { bad++; }
    buf = null;
    continue;
  }
  buf.push(line);
}
jsonl.end();
writeFileSync(`${out}/months.json`, JSON.stringify(months, null, 1));
console.log(`сообщений с текстом: ${n}, не разобрано: ${bad}`);
for (const [k, v] of Object.entries(months).sort()) console.log(k, String(v.text).padStart(7), '▏' + '█'.repeat(Math.round(v.text / 2000)));
