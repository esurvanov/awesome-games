import sharp from 'sharp';
const O = process.argv[2];
function rgb2hsv(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return [h, mx ? d / mx : 0, mx]; }
function hsv2rgb(h, s, v) { const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c; let r, g, b; if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x]; return [r + m, g + m, b + m]; }
async function recolor(src, out, { hue, sat = 1, val = 1, lightTint = null }) {
  const { data, info } = await sharp(src).resize(1024, 1024).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 3) {
    let [h, s, v] = rgb2hsv(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    const light = v > 0.72 && s < 0.35;
    if (light) { if (lightTint) { h = lightTint[0]; s = s * 0.5 + lightTint[1]; } }
    else { h = (h + hue) % 360; s = Math.min(1, s * sat); v = Math.min(1, v * val); }
    const [r, g, b] = hsv2rgb(h, s, v); data[i] = r * 255; data[i + 1] = g * 255; data[i + 2] = b * 255;
  }
  await sharp(data, { raw: info }).jpeg({ quality: 88 }).toFile(out);
}
await recolor(`${O}/T_Peasant_BaseColor.png`, 'tex_man.jpg', { hue: 190, sat: 0.8, val: 1.05, lightTint: [210, 0.05] });
await recolor(`${O}/T_Peasant_BaseColor.png`, 'tex_woman.jpg', { hue: 130, sat: 0.75, val: 1.1, lightTint: null });
console.log('ok');
await recolor(`${O}/T_Peasant_2_BaseColor.png`, 'tex_man_b.jpg', { hue: 0, sat: 1.0, val: 1.15, lightTint: null });
await recolor(`${O}/T_Peasant_BaseColor.png`, 'tex_woman_b.jpg', { hue: 250, sat: 0.7, val: 1.15, lightTint: [330, 0.08] });
