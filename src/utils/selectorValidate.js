import { CONFIG } from '../config.js';

// Reject Playwright engine-prefixed selectors (xpath=, text=, id=, css=, role=,
// nth=, visible=, internal:*, _react=, _vue=) and chain operators (`>>` / `>>>`).
// We accept only plain CSS selectors so a malicious caller cannot pivot into
// XPath / text-content matching to exfiltrate page content via element text.
const ENGINE_PREFIX = /^\s*(xpath|text|id|css|role|nth|visible|internal:[\w-]+|_react|_vue|data-testid|alt|placeholder|title|label)\s*=/i;
const CHAIN_OPERATOR = />>/;

export function validateSelector(selector) {
  if (typeof selector !== 'string' || selector.length === 0
      || selector.length > CONFIG.SELECTOR_MAX_LEN) {
    throw new Error('Invalid selector');
  }
  if (ENGINE_PREFIX.test(selector) || CHAIN_OPERATOR.test(selector)) {
    throw new Error('Invalid selector');
  }
  return selector;
}
