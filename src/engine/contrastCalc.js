// WCAG 2.1 relative luminance and contrast ratio math.

function parseHex(hex) {
  if (typeof hex !== 'string') throw new Error('Invalid hex color');
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6 || !/^[0-9a-f]{6}$/i.test(h)) throw new Error('Invalid hex color');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function channelLum(c255) {
  const c = c255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex) {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * channelLum(r) + 0.7152 * channelLum(g) + 0.0722 * channelLum(b);
}

export function relativeLuminanceRgb(r, g, b) {
  return 0.2126 * channelLum(r) + 0.7152 * channelLum(g) + 0.0722 * channelLum(b);
}

export function contrastRatio(hex1, hex2) {
  const L1 = relativeLuminance(hex1);
  const L2 = relativeLuminance(hex2);
  const lighter = Math.max(L1, L2);
  const darker  = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function requiredRatio(isLargeText, level = 'AA') {
  if (level === 'AAA') return isLargeText ? 4.5 : 7;
  return isLargeText ? 3 : 4.5; // AA
}

export function meetsThreshold(ratio, isLargeText, level = 'AA') {
  return ratio >= requiredRatio(isLargeText, level);
}

// Parse CSS rgb()/rgba() → { r, g, b } with 0-255 channels.
export function parseRgbString(str) {
  if (typeof str !== 'string') throw new Error('Invalid rgb string');
  const m = str.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
  if (!m) throw new Error('Invalid rgb string');
  return {
    r: Math.round(parseFloat(m[1])),
    g: Math.round(parseFloat(m[2])),
    b: Math.round(parseFloat(m[3])),
  };
}

export function rgbToHex(r, g, b) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const h = v => clamp(v).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
