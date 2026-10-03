// Minimal TypeSafe System One client (no deps). The key is read from env or ../.env and never logged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ENDPOINT = process.env.TYPESAFE_ENDPOINT || 'https://api.typesafe.ai/v1/systemone';
export const MODEL = process.env.TYPESAFE_MODEL || 'jev-latest';
export const USD_PER_INPUT_TOKEN = 42 / 1e9; // $42 per 1B input tokens, output is free

export function loadKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY.trim();
  for (const f of [path.join(HERE, '..', '.env'), path.join(HERE, '.env')]) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/^\s*TYPESAFE_API_KEY\s*=\s*["']?([^"'\r\n]+)/m);
      if (m) return m[1].trim();
    } catch { /* no file */ }
  }
  return '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class UpstreamError extends Error {
  constructor(msg, status, retryAfterMs) { super(msg); this.status = status; this.retryAfterMs = retryAfterMs; }
}

/**
 * One System One call with a hard deadline. Retries 429/529/5xx/network with exponential backoff
 * (honours retry-after) but never past `deadlineMs` — the game prefers a fast fallback to a late answer.
 */
export async function systemOne({ key, state, questions, model = MODEL, deadlineMs = 1500, maxRetries = 2, fetchImpl = fetch }) {
  if (!key) throw new UpstreamError('no api key', 0);
  const t0 = Date.now(), end = t0 + deadlineMs;
  let attempt = 0, lastErr;
  while (true) {
    const left = end - Date.now();
    if (left <= 50) throw lastErr || new UpstreamError('deadline', 0);
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), left);
    try {
      const r = await fetchImpl(ENDPOINT, {
        method: 'POST', signal: ac.signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, state, questions }),
      });
      clearTimeout(timer);
      if (r.ok) {
        const j = await r.json();
        return { answers: j.answers || {}, usage: j.usage || { input_tokens: 0, output_tokens: 0 }, model: j.model, ms: Date.now() - t0, attempts: attempt + 1 };
      }
      const ra = +(r.headers.get('retry-after') || 0) * 1000;
      let detail = ''; try { detail = (await r.text()).slice(0, 300); } catch { /* ignore */ }
      lastErr = new UpstreamError(`upstream ${r.status} ${detail}`, r.status, ra);
      if (!(r.status === 429 || r.status === 529 || r.status >= 500) || attempt >= maxRetries) throw lastErr;
      const back = Math.max(ra, 150 * 2 ** attempt + Math.random() * 100);
      if (Date.now() + back >= end - 100) throw lastErr;
      await sleep(back);
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof UpstreamError) throw e;
      lastErr = new UpstreamError(e.name === 'AbortError' ? 'timeout' : 'network ' + e.message, 0);
      if (e.name === 'AbortError' || attempt >= maxRetries) throw lastErr;
      await sleep(150 * 2 ** attempt);
    }
    attempt++;
  }
}
