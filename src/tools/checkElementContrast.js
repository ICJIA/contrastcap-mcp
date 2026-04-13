import { CONFIG } from '../config.js';
import { validateUrl } from '../utils/urlValidate.js';
import { validateSelector } from '../utils/selectorValidate.js';
import { withPage } from '../browser.js';
import { sampleBackgroundColor } from '../engine/pixelSampler.js';
import {
  contrastRatio,
  requiredRatio,
  parseRgbString,
  rgbToHex,
} from '../engine/contrastCalc.js';
import { suggestFix } from '../engine/colorSuggest.js';
import { isLargeText } from '../utils/largeText.js';
import { formatElementResult } from '../utils/formatResults.js';
import { withAuditTimeout } from './auditPage.js';

function rgbStringToHex(rgbStr) {
  const { r, g, b } = parseRgbString(rgbStr);
  return rgbToHex(r, g, b);
}

export async function checkElementContrast(params) {
  const level = params.level || CONFIG.DEFAULT_LEVEL;
  const selector = validateSelector(params.selector);

  const validated = await validateUrl(params.url);

  return withAuditTimeout(withPage(async (page) => {
    await page.goto(validated, {
      timeout: CONFIG.NAV_TIMEOUT,
      waitUntil: 'networkidle',
    }).catch(async (err) => {
      if (/Timeout/i.test(err.message || '')) {
        await page.goto(validated, { timeout: CONFIG.NAV_TIMEOUT, waitUntil: 'load' });
      } else {
        throw err;
      }
    });

    await validateUrl(page.url()); // post-redirect re-check

    const element = await page.$(selector);
    if (!element) throw new Error('Element not found');

    try {
      await element.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
      const box = await element.boundingBox();
      if (!box || box.width * box.height < 4) {
        throw new Error('Element has zero size');
      }

      const meta = await element.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          color:      cs.color,
          fontSize:   cs.fontSize,
          fontWeight: cs.fontWeight,
          text:       (el.textContent || '').trim(),
        };
      });

      const fgPx = parseFloat(meta.fontSize);
      const large = isLargeText(fgPx, meta.fontWeight);
      const required = requiredRatio(large, level);

      const fgHex = rgbStringToHex(meta.color);
      const bg = await sampleBackgroundColor(page, element, box, meta.color);
      const ratio = contrastRatio(fgHex, bg.hex);
      const pass = ratio >= required;

      const entry = {
        selector,
        text:        meta.text,
        ratio,
        required,
        pass,
        fontSize:    meta.fontSize,
        fontWeight:  meta.fontWeight,
        isLargeText: large,
        foreground:  fgHex,
        background:  bg.hex,
        backgroundSource: bg.source,
      };
      if (!pass) entry.suggestion = suggestFix(fgHex, bg.hex, large, level);
      if (pass && (ratio < required + CONFIG.MARGINAL_DELTA)) {
        entry.note = `Ratio within ${CONFIG.MARGINAL_DELTA} of threshold — marginal.`;
      }
      if (bg.highVariance && !entry.note) {
        entry.note = 'Background sampled from gradient or image — may vary at other positions.';
      }

      return formatElementResult({ url: page.url(), wcagLevel: level, entry });
    } finally {
      await element.dispose().catch(() => {});
    }
  }));
}
