// Эхо Разлома — local game server: static files + POST /api/decide (TypeSafe proxy) + GET /api/stats.
// Usage: node server/server.mjs [--port 8790] [--open]      (Node 18+, no dependencies)
// The API key is read from $TYPESAFE_API_KEY or ../.env and is never sent to the page, logged, or written to cache.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { systemOne, loadKey, MODEL, USD_PER_INPUT_TOKEN } from './typesafe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.webp': 'image/webp' };

const pct = (arr, p) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const today = () => new Date().toISOString().slice(0, 10);

export function startServer(opts = {}) {
  const root = path.resolve(opts.root || path.join(HERE, '..'));
  const content = opts.content || require(path.join(root, 'ai-content.js'));
  const cacheDir = opts.cacheDir || path.join(HERE, 'cache');
  const key = opts.key !== undefined ? opts.key : loadKey();
  const fetchImpl = opts.fetchImpl || fetch;
  const dailyUsd = +(opts.dailyUsd ?? process.env.AI_DAILY_USD ?? 1);
  const quiet = !!opts.quiet;
  fs.mkdirSync(cacheDir, { recursive: true });
  const log = (...a) => { if (!quiet) console.log(new Date().toISOString().slice(11, 19), ...a); };

  /* ---------- cache (memory + disk) ---------- */
  const cacheFile = path.join(cacheDir, 'cache.json');
  const cache = new Map();
  try { const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); const now = Date.now(); for (const [k, v] of Object.entries(j)) if (v.exp > now) cache.set(k, v); } catch { /* fresh */ }
  let flushT = null;
  const flushCache = () => {
    flushT = null; const now = Date.now(), o = {};
    for (const [k, v] of cache) if (v.exp > now) o[k] = v;
    const keys = Object.keys(o); if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 5000)) delete o[k];
    try { fs.writeFileSync(cacheFile + '.tmp', JSON.stringify(o)); fs.renameSync(cacheFile + '.tmp', cacheFile); } catch (e) { log('cache write failed', e.message); }
  };
  const scheduleFlush = () => { if (!flushT) flushT = setTimeout(flushCache, 2000); };
  const inflight = new Map();

  /* ---------- usage & stats ---------- */
  const usageFile = path.join(cacheDir, 'usage.json');
  let usage = { total: { calls: 0, in: 0, out: 0, usd: 0 }, days: {} };
  try { usage = JSON.parse(fs.readFileSync(usageFile, 'utf8')); } catch { /* fresh */ }
  const sets = {};
  const setStat = (id) => (sets[id] ||= { requests: 0, hits: 0, upstream: 0, errors: 0, rejected: 0, in: 0, out: 0, usd: 0, lat: [], latHit: [] });
  const started = Date.now();
  let saveUsageT = null;
  const saveUsage = () => { if (!saveUsageT) saveUsageT = setTimeout(() => { saveUsageT = null; try { fs.writeFileSync(usageFile, JSON.stringify(usage, null, 1)); } catch { /* ignore */ } }, 1500); };
  function account(id, u) {
    const i = u.input_tokens || 0, o = u.output_tokens || 0, usd = i * USD_PER_INPUT_TOKEN, d = (usage.days[today()] ||= { calls: 0, in: 0, out: 0, usd: 0 });
    for (const t of [usage.total, d]) { t.calls++; t.in += i; t.out += o; t.usd += usd; }
    const s = setStat(id); s.in += i; s.out += o; s.usd += usd; saveUsage();
  }

  /* ---------- protection: rate limit, concurrency, circuit breaker, daily budget ---------- */
  const buckets = new Map(); const RL_CAP = +(opts.rlCap || 20), RL_RATE = +(opts.rlRate || 5); // burst 20, 5 req/s sustained per client
  const allow = (ip) => { const now = Date.now(); const b = buckets.get(ip) || { t: RL_CAP, at: now }; b.t = Math.min(RL_CAP, b.t + (now - b.at) / 1000 * RL_RATE); b.at = now; buckets.set(ip, b); if (b.t < 1) return false; b.t -= 1; return true; };
  let active = 0; const MAX_ACTIVE = 8;
  const circuit = { until: 0, n: 0, last: '' };
  const trip = (why, retryAfterMs) => { circuit.n++; const ms = Math.max(retryAfterMs || 0, Math.min(60000, 1000 * 2 ** (circuit.n - 1))); circuit.until = Date.now() + ms; circuit.last = why; log('circuit open', ms + 'ms', why); };

  function statsJson() {
    const per = {};
    for (const [id, s] of Object.entries(sets)) per[id] = { requests: s.requests, cacheHits: s.hits, upstream: s.upstream, errors: s.errors, rejected: s.rejected, inputTokens: s.in, outputTokens: s.out, usd: +s.usd.toFixed(6),
      p50ms: pct(s.lat, 0.5), p95ms: pct(s.lat, 0.95), hitP50ms: pct(s.latHit, 0.5) };
    const d = usage.days[today()] || { calls: 0, in: 0, out: 0, usd: 0 };
    return { ok: true, ai: !!key, model: MODEL, contentVersion: content.VERSION, uptimeS: Math.round((Date.now() - started) / 1000), sets: per, cacheEntries: cache.size,
      today: { ...d, usd: +d.usd.toFixed(6), budgetUsd: dailyUsd }, total: { ...usage.total, usd: +usage.total.usd.toFixed(6) },
      circuit: { open: Date.now() < circuit.until, reason: circuit.last, failures: circuit.n } };
  }

  /* ---------- /api/decide ---------- */
  async function decide(body, ip) {
    const t0 = Date.now();
    const setId = String(body && body.set || '');
    if (!Object.prototype.hasOwnProperty.call(content.SETS, setId)) return [400, { ok: false, reason: 'unknown set' }];
    const st = setStat(setId); st.requests++;
    let prepared;
    try { prepared = content.prepare(setId, body.state); } catch (e) { st.rejected++; return [422, { ok: false, reason: 'bad state: ' + e.message }]; }
    const { set, s } = prepared;
    const built = set.build(s);
    const ck = crypto.createHash('sha256').update(content.VERSION + '|' + MODEL + '|' + setId + '|' + JSON.stringify(built)).digest('hex').slice(0, 32);
    const hit = cache.get(ck);
    if (hit && hit.exp > Date.now()) { st.hits++; const ms = Date.now() - t0; st.latHit.push(ms); if (st.latHit.length > 500) st.latHit.shift(); return [200, { ok: true, set: setId, answers: hit.answers, meta: { cached: true, ms, model: hit.model } }]; }
    if (!key) return [503, { ok: false, reason: 'no key' }];
    if (!allow(ip)) { st.rejected++; return [429, { ok: false, reason: 'rate limit' }]; }
    if (Date.now() < circuit.until) { st.rejected++; return [503, { ok: false, reason: 'cooldown' }]; }
    const d = usage.days[today()]; if (d && d.usd >= dailyUsd) { st.rejected++; return [503, { ok: false, reason: 'daily budget' }]; }
    let p = inflight.get(ck);
    if (!p) {
      if (active >= MAX_ACTIVE) { st.rejected++; return [503, { ok: false, reason: 'busy' }]; }
      active++;
      p = systemOne({ key, state: built.state, questions: built.questions, deadlineMs: +(body.deadlineMs) > 0 ? Math.min(4000, +body.deadlineMs) : set.timeoutMs, fetchImpl })
        .finally(() => { active--; inflight.delete(ck); });
      inflight.set(ck, p);
      p.then((r) => { account(setId, r.usage); circuit.n = 0; cache.set(ck, { exp: Date.now() + set.ttl * 1000, answers: r.answers, model: r.model }); scheduleFlush(); }, () => {});
    }
    try {
      const r = await p; st.upstream++; const ms = Date.now() - t0; st.lat.push(ms); if (st.lat.length > 500) st.lat.shift();
      return [200, { ok: true, set: setId, answers: r.answers, meta: { cached: false, ms, upstreamMs: r.ms, attempts: r.attempts, model: r.model, tokens: { in: r.usage.input_tokens, out: r.usage.output_tokens } } }];
    } catch (e) {
      st.errors++;
      if (e.status === 429 || e.status === 529) trip('upstream ' + e.status, e.retryAfterMs);
      else if (e.status === 401 || e.status === 403) trip('auth', 60000);
      else if (!e.status) trip(e.message.slice(0, 40), 0);
      log('decide', setId, 'failed:', e.status || '', e.message.slice(0, 120));
      return [502, { ok: false, reason: e.status === 422 ? 'upstream rejected request' : 'upstream ' + (e.status || e.message.slice(0, 30)) }];
    }
  }

  /* ---------- http ---------- */
  const readBody = (req, cap) => new Promise((res, rej) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > cap) { rej(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8'))); req.on('error', rej);
  });
  const send = (res, code, obj, extra = {}) => { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }); res.end(b); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ip = req.socket.remoteAddress || '?';
    try {
      if (url.pathname.startsWith('/api/')) {
        // same-origin only: block other websites from driving the local proxy
        const origin = req.headers.origin;
        if (origin && origin !== 'http://' + req.headers.host) return send(res, 403, { ok: false, reason: 'origin' });
        if (url.pathname === '/api/stats' && req.method === 'GET') return send(res, 200, statsJson());
        // rock gallery review marks (tools/rockgallery): the human verdict, kept in the repo next to the gallery
        if (url.pathname === '/api/marks') {
          const dir = path.join(root, 'tools', 'rockgallery', 'marks'), ok = (l) => /^[\w.-]{1,48}$/.test(l);
          if (req.method === 'GET') { const l = url.searchParams.get('label') || ''; if (!ok(l)) return send(res, 400, { ok: false });
            try { return send(res, 200, JSON.parse(fs.readFileSync(path.join(dir, l + '.json'), 'utf8'))); } catch { return send(res, 200, { ok: true, label: l, marks: {} }); } }
          if (req.method === 'POST' && String(req.headers['content-type'] || '').startsWith('application/json')) {
            let body; try { body = JSON.parse(await readBody(req, 512 * 1024)); } catch { return send(res, 413, { ok: false, reason: 'body' }); }
            if (!body || !ok(String(body.label || '')) || typeof body.marks !== 'object' || Array.isArray(body.marks)) return send(res, 400, { ok: false });
            const marks = {}; for (const [k, v] of Object.entries(body.marks)) { if (!/^[\w.-]{1,80}$/.test(k) || !v || typeof v !== 'object') continue;
              marks[k] = { v: v.v === 'yes' || v.v === 'no' ? v.v : null, note: String(v.note || '').slice(0, 500) }; }
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, body.label + '.json'), JSON.stringify({ ok: true, label: body.label, at: new Date().toISOString(), marks }, null, 1));
            return send(res, 200, { ok: true, n: Object.keys(marks).length });
          }
          return send(res, 405, { ok: false });
        }
        if (req.method !== 'POST' || !String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 405, { ok: false });
        if (url.pathname === '/api/decide') {
          let body; try { body = JSON.parse(await readBody(req, 16 * 1024)); } catch { return send(res, 413, { ok: false, reason: 'body' }); }
          const [code, obj] = await decide(body, ip); return send(res, code, obj);
        }
        if (url.pathname === '/api/world-dump') {
          let raw; try { raw = await readBody(req, 8 * 1024 * 1024); JSON.parse(raw); } catch { return send(res, 413, { ok: false }); }
          fs.writeFileSync(path.join(cacheDir, 'world-dump.json'), raw); log('world dump saved', raw.length, 'bytes'); return send(res, 200, { ok: true, bytes: raw.length });
        }
        return send(res, 404, { ok: false });
      }
      // static files — never serve dotfiles (.env!) or the server folder (cache, usage)
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += fs.existsSync(path.join(root, rel, 'index.html')) ? 'index.html' : 'open-world.html';
      const segs = rel.split('/').filter(Boolean);
      if (segs.some((s) => s.startsWith('.') || s === '..') || segs[0] === 'server' || segs[0] === 'node_modules') { res.writeHead(404); return res.end(); }
      const file = path.join(root, ...segs);
      if (!file.startsWith(root + path.sep)) { res.writeHead(404); return res.end(); }
      fs.stat(file, (err, stt) => {
        if (err || !stt.isFile()) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': stt.size, 'cache-control': 'no-cache' });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file).pipe(res);
      });
    } catch (e) { log('error', e.message); if (!res.headersSent) send(res, 500, { ok: false }); }
  });

  const host = opts.host || process.env.HOST || '127.0.0.1';
  const ready = new Promise((resolve, reject) => {
    let port = opts.port ?? 8790, tries = 0;
    server.on('error', (e) => { if (e.code === 'EADDRINUSE' && port && tries++ < 10) { log('port', port, 'busy, trying', port + 1); server.listen(++port, host); } else reject(e); });
    server.on('listening', () => resolve(server.address().port));
    server.listen(port, host);
  });
  const close = () => new Promise((r) => { if (flushT) { clearTimeout(flushT); flushCache(); } server.close(() => r()); server.closeAllConnections?.(); });
  return { server, ready, close, stats: statsJson, cache, flushCache };
}

/* ---------- CLI ---------- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
  const port = +(arg('port', process.env.PORT || 8790));
  const srv = startServer({ port });
  srv.ready.then((p) => {
    const page = arg('page', fs.existsSync(path.join(HERE, '..', 'open-world.html')) ? 'open-world.html' : 'index.html');
    const url = `http://localhost:${p}/${page}`;
    console.log(`Эхо Разлома · ${url}\nAI: ${srv.stats().ai ? 'on (TypeSafe ' + MODEL + ')' : 'off — no TYPESAFE_API_KEY, game runs on rule fallbacks'}\nStats: http://localhost:${p}/api/stats\nCtrl+C to stop`);
    if (process.argv.includes('--open')) exec((process.platform === 'darwin' ? 'open ' : process.platform === 'win32' ? 'start ' : 'xdg-open ') + JSON.stringify(url));
  });
  const stop = () => srv.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
