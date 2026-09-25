/* hygiene.mjs — measurement hygiene for every benchmark tool (stand, eye, qa, autoplay).
 *
 *   acquireLock(label, { wait = true, timeoutMs = 30 min, log })  → release()
 *       One benchmark browser at a time on this machine: tools/.stand.lock holds { pid, label, started }.
 *       A lock whose pid is dead is stale and taken over. Waiters queue FIFO through ticket files in
 *       tools/.stand-queue/ (oldest live ticket goes next). release() is also called on exit / SIGINT / SIGTERM.
 *   machineLoad({ excludePids })  → { otherHeadless, otherHeadlessPids, cpuPct, cpuCores, load1, busy, reasons }
 *       other headless / automation Chrome main processes (any tool: puppeteer, playwright) + total CPU use of
 *       everything that is not ours. busy = otherHeadless > 0 || other processes > 50 % of all cores || load1 > cores.
 *   quietCheck(opts)  → same + { quiet: !busy } ; fps conclusions from a busy machine are refused by the callers.
 *   spreadStats(samples) → { median, min, max, spreadPct, noisy (spread > 15 %) }
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOCK = path.join(TOOLS, '.stand.lock');
const QUEUE = path.join(TOOLS, '.stand-queue');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readLock = () => { try { return JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch (e) { return null; } };

export async function acquireLock(label, { wait = true, timeoutMs = 30 * 60e3, log = console.log } = {}) {
  // a child run of a lock holder (qa.mjs → stand.mjs) inherits the lock: STAND_LOCK_PARENT = the holder's pid
  const inh = Number(process.env.STAND_LOCK_PARENT || 0), cur0 = readLock();
  if (inh && cur0 && cur0.pid === inh && alive(inh)) return () => {};
  fs.mkdirSync(QUEUE, { recursive: true });
  const ticket = path.join(QUEUE, `${Date.now()}-${process.pid}`);
  fs.writeFileSync(ticket, label);
  const t0 = Date.now(); let said = 0;
  const cleanTicket = () => { try { fs.unlinkSync(ticket); } catch (e) { /* gone */ } };
  for (;;) {
    // FIFO: am I the oldest live ticket?
    const tickets = fs.readdirSync(QUEUE).sort();
    let first = null;
    for (const t of tickets) { const pid = Number(t.split('-')[1]); if (alive(pid)) { first = t; break; } try { fs.unlinkSync(path.join(QUEUE, t)); } catch (e) { /* raced */ } }
    const cur = readLock();
    if (cur && !alive(cur.pid)) { log(`[lock] stale lock of pid ${cur.pid} (${cur.label}) removed`); try { fs.unlinkSync(LOCK); } catch (e) { /* raced */ } }
    if (first === path.basename(ticket)) {
      try {
        const fd = fs.openSync(LOCK, 'wx');
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, label, started: new Date().toISOString() })); fs.closeSync(fd);
        cleanTicket();
        let released = false;
        const release = () => { if (released) return; released = true; const c = readLock(); if (c && c.pid === process.pid) try { fs.unlinkSync(LOCK); } catch (e) { /* gone */ } };
        process.once('exit', release);
        for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { release(); process.exit(130); });
        if (Date.now() - t0 > 1500) log(`[lock] acquired after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        return release;
      } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    if (!wait) { cleanTicket(); throw new Error(`benchmark lock held by pid ${cur && cur.pid} (${cur && cur.label})`); }
    if (Date.now() - t0 > timeoutMs) { cleanTicket(); throw new Error('timed out waiting for the benchmark lock'); }
    if (Date.now() - said > 30e3) { said = Date.now(); const c = readLock(); log(`[lock] waiting: held by pid ${c ? c.pid + ' (' + c.label + ', since ' + c.started + ')' : '—'}; queue ${fs.readdirSync(QUEUE).length}`); }
    await sleep(1000);
  }
}

// every process: pid, ppid, %cpu, args
function procs() {
  try {
    return execSync('ps -Ao pid=,ppid=,pcpu=,args=', { maxBuffer: 32 << 20 }).toString().split('\n').map((l) => {
      const m = l.trim().match(/^(\d+)\s+(\d+)\s+([\d.,]+)\s+(.*)$/); if (!m) return null;
      return { pid: +m[1], ppid: +m[2], cpu: parseFloat(m[3].replace(',', '.')) || 0, args: m[4] };
    }).filter(Boolean);
  } catch (e) { return []; }
}

export function machineLoad({ excludePids = [] } = {}) {
  const P = procs(), byPid = new Map(P.map((p) => [p.pid, p]));
  // our own process tree (node + the browser we launched + its helpers) never counts
  const mine = new Set([process.pid, ...excludePids]);
  let grew = true; while (grew) { grew = false; for (const p of P) if (!mine.has(p.pid) && mine.has(p.ppid)) { mine.add(p.pid); grew = true; } }
  const isChromeMain = (p) => /Google Chrome( for Testing)?(\.app\/Contents\/MacOS\/Google Chrome)?( |$)|chrome-headless-shell|Chromium( |$)/.test(p.args) && !/Helper/.test(p.args) && !/--type=/.test(p.args);
  const headless = P.filter((p) => !mine.has(p.pid) && isChromeMain(p) && /--headless|--enable-automation|--remote-debugging/.test(p.args));
  // CPU of the other headless browsers' whole trees (their GPU/renderer helpers)
  const cores = os.cpus().length;
  let cpu = 0; for (const p of P) if (!mine.has(p.pid) && !/^ps /.test(p.args)) cpu += p.cpu;
  const load1 = os.loadavg()[0];
  const reasons = [];
  if (headless.length) reasons.push(`${headless.length} other headless/automation Chrome (pid ${headless.map((p) => p.pid).join(', ')})`);
  const cpuPct = cpu / cores;   // % of the whole machine
  if (cpuPct > 50) reasons.push(`other processes use ${cpuPct.toFixed(0)} % of ${cores} cores`);
  if (load1 > cores * 1.0) reasons.push(`load average ${load1.toFixed(1)} on ${cores} cores`);
  return { otherHeadless: headless.length, otherHeadlessPids: headless.map((p) => p.pid), cpuPct: +cpuPct.toFixed(1), cpuCores: cores, load1: +load1.toFixed(2), busy: reasons.length > 0, reasons };
}

export function quietCheck(opts) { const m = machineLoad(opts); return Object.assign(m, { quiet: !m.busy }); }

export function spreadStats(samples) {
  const s = samples.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return { median: null, min: null, max: null, spreadPct: null, noisy: true, n: 0 };
  const median = s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  const spreadPct = median ? (s[s.length - 1] - s[0]) / median * 100 : 0;
  return { median: +median.toFixed(2), min: s[0], max: s[s.length - 1], spreadPct: +spreadPct.toFixed(1), noisy: spreadPct > 15, n: s.length };
}
