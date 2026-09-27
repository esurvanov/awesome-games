/* webp.mjs — mux still WebP frames (from canvas.toDataURL('image/webp')) into one animated WebP. No dependencies.
 *   animatedWebp(frames: Buffer[], { width, height, durationMs = 80, loop = 0 }) → Buffer
 * Each input frame is a complete RIFF/WEBP file; its ALPH + VP8/VP8L chunks become one ANMF frame.
 */
const chunk = (fourcc, data) => {
  const pad = data.length & 1, b = Buffer.alloc(8 + data.length + pad);
  b.write(fourcc, 0, 'ascii'); b.writeUInt32LE(data.length, 4); data.copy(b, 8); return b;
};
const u24 = (b, off, v) => { b[off] = v & 255; b[off + 1] = (v >> 8) & 255; b[off + 2] = (v >> 16) & 255; };
function frameChunks(file) {
  if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WEBP') throw new Error('not a WebP');
  const out = []; let alpha = false;
  for (let p = 12; p + 8 <= file.length;) {
    const id = file.toString('ascii', p, p + 4), n = file.readUInt32LE(p + 4), data = file.subarray(p + 8, p + 8 + n);
    if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') { out.push(chunk(id, data)); if (id === 'ALPH' || (id === 'VP8L' && (data[4] & 0x10))) alpha = true; }
    p += 8 + n + (n & 1);
  }
  return { chunks: Buffer.concat(out), alpha };
}
export function animatedWebp(frames, { width, height, durationMs = 80, loop = 0 } = {}) {
  let alpha = false; const anmf = [];
  for (const f of frames) {
    const fc = frameChunks(f); alpha = alpha || fc.alpha;
    const h = Buffer.alloc(16); u24(h, 0, 0); u24(h, 3, 0); u24(h, 6, width - 1); u24(h, 9, height - 1); u24(h, 12, durationMs); h[15] = 0b10;   // no blend, no dispose
    anmf.push(chunk('ANMF', Buffer.concat([h, fc.chunks])));
  }
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x02 | (alpha ? 0x10 : 0); u24(vp8x, 4, width - 1); u24(vp8x, 7, height - 1);
  const anim = Buffer.alloc(6); anim.writeUInt32LE(0xff0a0f1e, 0); anim.writeUInt16LE(loop, 4);
  const body = Buffer.concat([Buffer.from('WEBP'), chunk('VP8X', vp8x), chunk('ANIM', anim), ...anmf]);
  const riff = Buffer.alloc(8); riff.write('RIFF', 0, 'ascii'); riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}
export const dataUrlBuffer = (u) => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64');
