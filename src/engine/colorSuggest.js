import {
  relativeLuminance,
  contrastRatio,
  requiredRatio,
  rgbToHex,
} from './contrastCalc.js';

// Hex ⇄ HSL helpers. L is 0-100.

function hexToHsl(hex) {
  let h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let s = 0;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hue = (b - r) / d + 2; break;
      case b: hue = (r - g) / d + 4; break;
    }
    hue *= 60;
  }

  return { h: hue, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
  const sNorm = Math.max(0, Math.min(100, s)) / 100;
  const lNorm = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (0 <= hp && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else             [r, g, b] = [c, 0, x];

  const m = lNorm - c / 2;
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

// Bisect in [loInit, hiInit] for an L that meets threshold.
// preferHigher=true  → returns the MAX passing L in the range (used for darken: closer to original L)
// preferHigher=false → returns the MIN passing L in the range (used for lighten: closer to original L)
function findThresholdL(hsl, bgHex, loInit, hiInit, threshold, preferHigher) {
  if (hiInit < loInit) return null;
  const hiRatio = contrastRatio(hslToHex(hsl.h, hsl.s, hiInit), bgHex);
  const loRatio = contrastRatio(hslToHex(hsl.h, hsl.s, loInit), bgHex);
  if (hiRatio < threshold && loRatio < threshold) return null;

  let lo = loInit, hi = hiInit;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    const ratio = contrastRatio(hslToHex(hsl.h, hsl.s, mid), bgHex);
    if (preferHigher) {
      if (ratio >= threshold) lo = mid; else hi = mid;
    } else {
      if (ratio >= threshold) hi = mid; else lo = mid;
    }
  }
  const finalL = preferHigher ? lo : hi;
  // Sanity — confirm the final L actually meets the threshold.
  const finalHex = hslToHex(hsl.h, hsl.s, finalL);
  if (contrastRatio(finalHex, bgHex) < threshold) return null;
  return { l: finalL, hex: finalHex };
}

/**
 * Return the nearest hex color (by HSL lightness delta) to `fgHex`
 * that meets the WCAG threshold against `bgHex`. Hue and saturation
 * are preserved.
 */
export function suggestFix(fgHex, bgHex, isLargeText, level = 'AA') {
  const threshold = requiredRatio(isLargeText, level);
  const hsl = hexToHsl(fgHex);

  const darken  = findThresholdL(hsl, bgHex, 0,     hsl.l, threshold, /* preferHigher */ true);
  const lighten = findThresholdL(hsl, bgHex, hsl.l, 100,   threshold, /* preferHigher */ false);

  if (darken && lighten) {
    return Math.abs(darken.l - hsl.l) <= Math.abs(lighten.l - hsl.l) ? darken.hex : lighten.hex;
  }
  if (darken)  return darken.hex;
  if (lighten) return lighten.hex;

  // Fallback: no solution preserving hue/sat — e.g. white-on-white.
  return relativeLuminance(bgHex) > 0.5 ? '#000000' : '#ffffff';
}

export const _test = { hexToHsl, hslToHex, findThresholdL };
