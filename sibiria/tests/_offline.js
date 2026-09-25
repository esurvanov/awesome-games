// Подгружается run-all.js через NODE_OPTIONS=--require: каждой новой странице playwright
// отключает Google Fonts (тесты не зависят от сети и не висят на goto).
const pw = require('playwright');
const FONTS = /fonts\.(googleapis|gstatic)\.com/;
const wrapCtx = ctx => { ctx.route(FONTS, r => r.abort()).catch(() => {}); return ctx; };
const origLaunch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...a) => {
  const b = await origLaunch(...a);
  const nc = b.newContext.bind(b), np = b.newPage.bind(b);
  b.newContext = async (...x) => wrapCtx(await nc(...x));
  b.newPage = async (...x) => { const p = await np(...x); await p.route(FONTS, r => r.abort()); return p; };
  return b;
};
