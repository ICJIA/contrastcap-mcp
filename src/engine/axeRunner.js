import axeCore from 'axe-core';

const AXE_SOURCE = axeCore.source;

/**
 * Inject axe-core into the page and run the color-contrast rule only.
 *
 * Returns flattened arrays of nodes (not rules) for violations / incomplete / passes.
 * Each node retains its original axe shape: { target, html, any, all, none, ... }.
 *
 * We trust axe's result for `violations` (definite failures with known colors)
 * and `passes` (definite passes). Our job is to re-resolve every `incomplete`
 * node via pixel sampling.
 */
export async function runContrastAudit(page) {
  await page.evaluate((source) => {
    // Guard against double-injection on re-runs
    if (!window.axe) {
      const s = document.createElement('script');
      s.textContent = source;
      document.head.appendChild(s);
    }
  }, AXE_SOURCE);

  const results = await page.evaluate(async () => {
    return await window.axe.run(document, {
      runOnly: { type: 'rule', values: ['color-contrast'] },
      resultTypes: ['violations', 'incomplete', 'passes'],
    });
  });

  const nodesOf = (arr) => (arr || []).flatMap(rule => rule.nodes || []);

  return {
    violations: nodesOf(results.violations),
    incomplete: nodesOf(results.incomplete),
    passes:     nodesOf(results.passes),
  };
}

/**
 * Extract the first usable CSS selector from an axe node.
 * axe sometimes returns nested selectors (shadow DOM, frames) — fall back to the
 * first element of the path.
 */
export function selectorFromNode(node) {
  if (!node || !node.target) return null;
  const t = node.target[0];
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t[0]; // nested context (shadow/iframe) — not reachable via page.$()
  return null;
}

/**
 * Pull axe's computed fg/bg (available on definite violations and many passes)
 * from the standard `color-contrast` data shape.
 */
export function axeColors(node) {
  const checks = [...(node.any || []), ...(node.all || []), ...(node.none || [])];
  for (const c of checks) {
    if (c?.data && (c.data.fgColor || c.data.bgColor)) {
      return {
        fgColor:          c.data.fgColor || null,
        bgColor:          c.data.bgColor || null,
        contrastRatio:    typeof c.data.contrastRatio === 'number' ? c.data.contrastRatio : null,
        fontSize:         c.data.fontSize || null,
        fontWeight:       c.data.fontWeight || null,
        expectedContrastRatio: typeof c.data.expectedContrastRatio === 'number' ? c.data.expectedContrastRatio : null,
      };
    }
  }
  return null;
}
