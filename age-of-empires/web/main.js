// port of main.py
// Chronicles of Kingdoms - a historical RTS. Launch: serve the repository root statically and open web/ (boot.js
// loads the assets, then imports this module).
import './src/_all.js';
import * as py from './runtime/py.js';
import { modules } from './runtime/py.js';
import { Game } from './src/ui.js';
import * as pygame from './runtime/pygame.js';

// the menu tiles draw unit sprite sheets, which are downloaded on demand: fetch them before the first menu frame
try {
    await modules.menu_art.preload();
} catch (e) {
    console.warn('menu art preload failed', e);
}

const game = new Game();
// handle for automated checks (web/tests/e2e.mjs) and the browser console
window.__game = game;
window.__pygame = pygame;
window.__py = py;
await game.run();

// the Exit button (running = False) ends the loop: the page stays, show that the game is closed
{
    const canvas = document.getElementById('screen');
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0d0b08';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#d8c9a3';
    ctx.font = '600 34px Georgia, serif';
    ctx.fillText('Chronicles of Kingdoms', canvas.width / 2, canvas.height / 2 - 30);
    ctx.fillStyle = '#9c8f74';
    ctx.font = '18px Georgia, serif';
    ctx.fillText('The game is closed — reload the page to play again.', canvas.width / 2, canvas.height / 2 + 16);
    ctx.textAlign = 'start';
    canvas.style.cursor = 'default';
}
