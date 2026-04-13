import sharp from 'sharp';
import {
  parseRgbString,
  relativeLuminanceRgb,
  rgbToHex,
} from './contrastCalc.js';
import { CONFIG } from '../config.js';

/**
 * Sample the background color underneath an element by hiding its text
 * and screenshotting the bounding-box region, then reading pixels with sharp.
 *
 * Returns: { hex, source, highVariance }
 *   source: 'pixel-sample' | 'pixel-sample-over-image'
 */
export async function sampleBackgroundColor(page, elementHandle, box, fgColorCss) {
  // Playwright screenshot can't clip to width/height < 1
  const clip = {
    x:      Math.max(0, Math.floor(box.x)),
    y:      Math.max(0, Math.floor(box.y)),
    width:  Math.max(1, Math.floor(box.width)),
    height: Math.max(1, Math.floor(box.height)),
  };

  // Save the prior inline `style.color` so we restore exactly — clearing
  // inline style would lose an author-set inline color.
  await elementHandle.evaluate((el) => {
    el.dataset._ccPrevInlineColor = el.style.color || '';
    el.style.color = 'transparent';
  });

  let buffer;
  try {
    buffer = await page.screenshot({ clip, type: 'png', omitBackground: false });
  } finally {
    await elementHandle.evaluate((el) => {
      el.style.color = el.dataset._ccPrevInlineColor || '';
      delete el.dataset._ccPrevInlineColor;
    }).catch(() => { /* element may have detached — acceptable */ });
  }

  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info; // channels = 3 after removeAlpha
  const cols = 5, rows = 3;
  const samples = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = Math.min(Math.floor((c + 0.5) * width  / cols), width  - 1);
      const py = Math.min(Math.floor((r + 0.5) * height / rows), height - 1);
      const idx = (py * width + px) * channels;
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  const stddev = (k) => {
    const vals = samples.map(s => s[k]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / vals.length;
    return Math.sqrt(variance);
  };

  const highVariance =
    stddev('r') > CONFIG.VARIANCE_STDDEV ||
    stddev('g') > CONFIG.VARIANCE_STDDEV ||
    stddev('b') > CONFIG.VARIANCE_STDDEV;

  let bgRgb;
  if (highVariance) {
    // Worst-case: pick the sample that gives the least contrast against fg.
    // Light fg → use the lightest bg pixel; dark fg → use the darkest bg pixel.
    const fg = parseRgbString(fgColorCss);
    const fgLum = relativeLuminanceRgb(fg.r, fg.g, fg.b);
    const sorted = [...samples].sort(
      (a, b) => relativeLuminanceRgb(a.r, a.g, a.b) - relativeLuminanceRgb(b.r, b.g, b.b)
    );
    bgRgb = fgLum > 0.5 ? sorted[sorted.length - 1] : sorted[0];
  } else {
    const median = (k) => {
      const sorted = samples.map(s => s[k]).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    bgRgb = { r: median('r'), g: median('g'), b: median('b') };
  }

  return {
    hex: rgbToHex(bgRgb.r, bgRgb.g, bgRgb.b),
    source: highVariance ? 'pixel-sample-over-image' : 'pixel-sample',
    highVariance,
  };
}
