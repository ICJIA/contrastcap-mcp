/**
 * Large-text classification per WCAG 2.1.
 *
 * `fontSizePx` MUST be a resolved px value — read via
 * `getComputedStyle(el).fontSize` in the browser. Do not try to parse em/rem/pt
 * server-side: em is relative to the parent's computed size and cannot be
 * resolved without the element context.
 */
export function isLargeText(fontSizePx, fontWeight) {
  const px = typeof fontSizePx === 'number' ? fontSizePx : parseFloat(fontSizePx);
  const weight = parseInt(fontWeight, 10) || 400;
  if (!Number.isFinite(px)) return false;
  return px >= 24 || (px >= 18.66 && weight >= 700);
}
