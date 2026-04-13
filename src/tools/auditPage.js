import { CONFIG, log } from '../config.js';
import { validateUrl } from '../utils/urlValidate.js';
import { withPage } from '../browser.js';
import { runContrastAudit, selectorFromNode, axeColors } from '../engine/axeRunner.js';
import { sampleBackgroundColor } from '../engine/pixelSampler.js';
import {
  contrastRatio,
  requiredRatio,
  parseRgbString,
  rgbToHex,
} from '../engine/contrastCalc.js';
import { suggestFix } from '../engine/colorSuggest.js';
import { isLargeText } from '../utils/largeText.js';

function rgbStringToHex(rgbStr) {
  const { r, g, b } = parseRgbString(rgbStr);
  return rgbToHex(r, g, b);
}

function withinMarginalDelta(ratio, required) {
  return ratio < required + CONFIG.MARGINAL_DELTA && ratio >= required;
}

async function elementMeta(element) {
  return element.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      color:      cs.color,
      fontSize:   cs.fontSize,   // always resolved to "NNpx"
      fontWeight: cs.fontWeight,
      text:       (el.textContent || '').trim(),
    };
  });
}

/**
 * Resolve a single axe `incomplete` node via pixel sampling.
 * Returns one of: { kind: 'pass' | 'fail' | 'warning' | 'skipped', entry? }
 */
async function resolveIncomplete(page, node, level) {
  const selector = selectorFromNode(node);
  if (!selector || Array.isArray(node.target[0])) {
    // Nested context (shadow DOM or iframe) — we can't reach it via page.$()
    return { kind: 'skipped', reason: 'unreachable selector (shadow DOM or iframe)' };
  }

  let element;
  try { element = await page.$(selector); } catch { element = null; }
  if (!element) return { kind: 'skipped', reason: 'element not found' };

  try {
    await element.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => { /* ignore */ });

    const box = await element.boundingBox();
    if (!box || box.width * box.height < 4) {
      return { kind: 'skipped', reason: 'zero-size element' };
    }

    const meta = await elementMeta(element);
    const fgPx = parseFloat(meta.fontSize);
    const large = isLargeText(fgPx, meta.fontWeight);
    const required = requiredRatio(large, level);

    const fgHex = rgbStringToHex(meta.color);

    const bg = await sampleBackgroundColor(page, element, box, meta.color);
    const ratio = contrastRatio(fgHex, bg.hex);

    const passes = ratio >= required;
    const marginal = !passes ? false : withinMarginalDelta(ratio, required);

    const base = {
      selector,
      text:         meta.text,
      ratio,
      required,
      level,
      fontSize:     meta.fontSize,
      fontWeight:   meta.fontWeight,
      isLargeText:  large,
      foreground:   fgHex,
      background:   bg.hex,
      backgroundSource: bg.source,
    };

    if (!passes) {
      base.suggestion = suggestFix(fgHex, bg.hex, large, level);
      return { kind: 'fail', entry: base };
    }

    // Passes — but mark warning if marginal or over high-variance background.
    if (marginal || bg.highVariance) {
      const notes = [];
      if (marginal) notes.push(`Ratio within ${CONFIG.MARGINAL_DELTA} of threshold — marginal.`);
      if (bg.highVariance) notes.push('Background sampled from gradient or image — may vary at other positions.');
      base.note = notes.join(' ');
      return { kind: 'warning', entry: base };
    }
    return { kind: 'pass' };
  } finally {
    await element.dispose().catch(() => {});
  }
}

function buildFailureFromViolation(node, level) {
  const selector = selectorFromNode(node);
  if (!selector) return null;
  const colors = axeColors(node);
  if (!colors || !colors.fgColor || !colors.bgColor) return null;

  const fgHex = rgbStringToHex(colors.fgColor);
  const bgHex = rgbStringToHex(colors.bgColor);

  const fgPx = parseFloat(colors.fontSize || '16');
  const fontWeight = colors.fontWeight || '400';
  const large = isLargeText(fgPx, fontWeight);
  const required = typeof colors.expectedContrastRatio === 'number'
    ? colors.expectedContrastRatio
    : requiredRatio(large, level);
  const ratio = typeof colors.contrastRatio === 'number'
    ? colors.contrastRatio
    : contrastRatio(fgHex, bgHex);

  return {
    selector,
    text: '',
    ratio,
    required,
    level,
    fontSize:   colors.fontSize,
    fontWeight: fontWeight,
    isLargeText: large,
    foreground: fgHex,
    background: bgHex,
    backgroundSource: 'computed',
    suggestion: suggestFix(fgHex, bgHex, large, level),
  };
}

/**
 * Run the full page-level audit pipeline and return aggregate counts + entries.
 *
 * @param {string} url
 * @param {'AA'|'AAA'} level
 * @returns {Promise<{ finalUrl, axePassCount, resolvedPassCount, failures, warnings, skippedCount }>}
 */
export async function auditPage(url, level) {
  const validated = await validateUrl(url);

  return withPage(async (page) => {
    await page.goto(validated, {
      timeout: CONFIG.NAV_TIMEOUT,
      waitUntil: 'networkidle',
    }).catch(async (err) => {
      // networkidle can be flaky on long-polling pages — fall back to 'load'
      if (/Timeout/i.test(err.message || '')) {
        await page.goto(validated, { timeout: CONFIG.NAV_TIMEOUT, waitUntil: 'load' });
      } else {
        throw err;
      }
    });

    // Post-redirect SSRF guard.
    await validateUrl(page.url());

    const { violations, incomplete, passes } = await runContrastAudit(page);

    // Fill in text snippets for violations so failure entries are readable.
    const failures = [];
    for (const node of violations) {
      const entry = buildFailureFromViolation(node, level);
      if (!entry) continue;
      try {
        const el = await page.$(entry.selector);
        if (el) {
          const txt = await el.evaluate((e) => (e.textContent || '').trim());
          entry.text = txt;
          await el.dispose().catch(() => {});
        }
      } catch { /* ignore */ }
      failures.push(entry);
    }

    const warnings = [];
    let resolvedPassCount = 0;
    let skippedCount = 0;
    let processed = 0;

    for (const node of incomplete) {
      if (processed >= CONFIG.MAX_ELEMENTS) {
        skippedCount++;
        continue;
      }
      processed++;

      let result;
      try {
        result = await Promise.race([
          resolveIncomplete(page, node, level),
          new Promise((_, rej) => setTimeout(
            () => rej(new Error('element timeout')),
            CONFIG.ELEMENT_TIMEOUT,
          )),
        ]);
      } catch (err) {
        log('debug', `element timeout/error: ${err.message}`);
        skippedCount++;
        continue;
      }

      if (result.kind === 'pass') resolvedPassCount++;
      else if (result.kind === 'fail') failures.push(result.entry);
      else if (result.kind === 'warning') warnings.push(result.entry);
      else skippedCount++;
    }

    return {
      finalUrl: page.url(),
      axePassCount: passes.length,
      resolvedPassCount,
      failures,
      warnings,
      skippedCount,
    };
  });
}

// ─── Audit timeout wrapper ────────────────────────────────────────

export function withAuditTimeout(promise, label = 'Audit') {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(
      () => rej(new Error(`${label} timed out`)),
      CONFIG.AUDIT_TIMEOUT,
    )),
  ]);
}
