// Общие шаги браузерных тестов: запуск Chromium с GPU, фильтр консоли, проход заставка → анкета → чат → зал,
// перемотка вечера (шаги симуляции пачкой через window.SKHODKA), клик по человеку в 3D.
import { chromium } from 'playwright';
export const GPU = ['--use-gl=angle', '--use-angle=' + (process.env.ANGLE || 'metal'), '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
export const launch = (extra = []) => chromium.launch({ headless: true, args: [...GPU, ...extra] });
// three r158 пишет предупреждение про устаревшую сборку build/three.min.js — оно допустимо
const NOISE = /deprecated|build\/three|GPU stall|GroupMarkerNotSet|Automatic fallback to software WebGL/i;
export function watch(pg, errs, tag = '') {
  pg.on('pageerror', e => errs.push(`${tag}PAGEERR ${e.message}\n${e.stack || ''}`));
  pg.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !NOISE.test(m.text())) errs.push(`${tag}${m.type()} ${m.text()}`); });
}
// заставка → анкета → чат → зал; profile — какие плитки выбрать
export async function enterHall(pg, { name = 'Егор', role = 'backend', topics = ['ai', 'sea', 'georgian'], need = 'flat', offer = 'job', glasses = true } = {}) {
  await pg.waitForSelector('.scr.title [data-go]', { timeout: 60000 });
  await pg.click('.scr.title [data-go]');
  await pg.fill('#pf-name', name);
  if (glasses) await pg.click('[data-k="glasses"][data-v="true"]');
  await pg.click('[data-next]');
  await pg.click(`[data-role="${role}"]`); await pg.click('[data-next]');
  for (const t of topics) { const b = await pg.$(`[data-topic="${t}"]`); if (b) await b.click(); }
  // если каких-то тем нет — добрать первыми попавшимися
  while (await pg.$eval('[data-next]', b => b.disabled)) await pg.click('[data-topic]:not(.on)');
  await pg.click('[data-next]');
  await pg.click(`[data-need="${need}"]`); await pg.click(`[data-offer="${offer}"]`); await pg.click('[data-next]');
  await pg.waitForSelector('.scr.prechat [data-go]');
  await pg.click('.poll-o[data-v="yes"]');
  await pg.click('.scr.prechat [data-go]');
  await pg.waitForFunction(() => window.SKHODKA && SKHODKA.w && !SKHODKA.ui.screenOn, null, { timeout: 30000 });
}
// перемотать вечер до часа h (или до конца), шагами симуляции; между пачками — кадр, чтобы 3D и UI успевали
export async function skipTo(pg, h, { batch = 900 } = {}) {
  for (;;) {
    const r = await pg.evaluate(([h, batch]) => {
      const G = SKHODKA, w = G.w; if (!w) return { done: true };
      for (let i = 0; i < batch && !w.over && w.hour < h; i++) w.step(1 / 30);
      return { done: w.over || w.hour >= h, hour: w.hour };
    }, [h, batch]);
    await pg.waitForTimeout(30);
    if (r.done) return r;
  }
}
// простые шаги симуляции (реальные секунды) — например, дождаться ответа в разговоре
export const simFor = (pg, sec) => pg.evaluate(sec => { const w = SKHODKA.w; for (let i = 0; i < sec * 30 && !w.over; i++) w.step(1 / 30); }, sec);
// экранная точка над 3D-фигурой человека (середина тела): для кликов мышью
export const screenOf = (pg, id) => pg.evaluate(id => {
  const G = SKHODKA, p = G.pp.map.get(id); if (!p) return null;
  const s = G.sc.toScreen(p.x, p.seat ? 0.95 : 1.2, p.z);
  const el = document.elementFromPoint(s.x, s.y);
  return { ...s, free: !!el && el.id === 'view' };
}, id);
// кто в зале: [{ id, step, d (до игрока), state }]
export const presentList = pg => pg.evaluate(() => {
  const w = SKHODKA.w, P = w.player;
  return w.list.filter(n => n.present && n.state !== 'gone').map(n => ({ id: n.id, step: n.step, state: n.state, d: Math.hypot(n.x - P.x, n.z - P.z), name: n.name }));
});
// кликнуть по человеку в 3D (свободная от UI точка); вернуть true, если клик дошёл до зала
export async function clickPerson(pg, id) {
  await pg.evaluate(() => { SKHODKA.sc.ctl.userT = 99; });
  const s = await screenOf(pg, id);
  if (!s || !s.visible || !s.free) return false;
  await pg.mouse.click(s.x, s.y);
  return true;
}
