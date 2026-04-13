# contrastcap-mcp — Doc 07: LLM Build Prompt

You are building **contrastcap-mcp**, a local MCP server that automates WCAG 2.x contrast auditing via pixel-level analysis. It resolves the "needs review" gap left by axe-core and SiteImprove by screenshotting element regions in headless Chromium and sampling actual rendered pixel colors.

---

## Tech Stack (mandatory — no substitutions)

- **Runtime**: Node.js 20+
- **MCP SDK**: `@modelcontextprotocol/server` (v2 alpha — same package viewcap and lightcap ship with)
- **Transport**: stdio (no HTTP, no ports)
- **Browser**: Playwright Chromium (`playwright`)
- **Accessibility**: `axe-core` (inject via `page.evaluate`, never reimplemented)
- **Image processing**: `sharp` (pixel buffer access)
- **Schema validation**: `zod` v4 (`import * as z from 'zod/v4'`)
- **CLI parsing**: `commander` (match viewcap/lightcap)
- **Package manager**: pnpm
- **No TypeScript** — plain ES module JavaScript (`.js` files, `"type": "module"` in package.json)

---

## File Structure

```
contrastcap-mcp/
├── package.json
├── .nvmrc
├── .gitignore
├── LICENSE
├── CLAUDE.md
├── README.md
├── CHANGELOG.md
├── publish.sh
├── src/
│   ├── cli.js                # Commander entry; dispatches to server.js for MCP or to CLI commands
│   ├── server.js             # MCP server entry, tool registration, browser lifecycle
│   ├── config.js             # CONFIG constants + log()/setVerbosity()
│   ├── browser.js            # Shared Playwright browser singleton
│   ├── tools/
│   │   ├── checkPageContrast.js
│   │   ├── checkElementContrast.js
│   │   └── getContrastSummary.js
│   ├── engine/
│   │   ├── contrastCalc.js   # WCAG luminance + ratio math
│   │   ├── pixelSampler.js   # Screenshot + pixel extraction
│   │   ├── colorSuggest.js   # Minimum-change fix suggestions (hex only)
│   │   └── axeRunner.js      # Playwright + axe-core integration
│   └── utils/
│       ├── largeText.js      # Font size/weight → large text detection
│       ├── urlValidate.js    # Shared URL validation (ports viewcap/lightcap's pattern)
│       ├── sanitizeError.js  # Error message sanitization
│       └── formatResults.js  # Output shaping for token economy
└── test/
    ├── contrastCalc.test.js
    ├── colorSuggest.test.js
    ├── largeText.test.js
    └── urlValidate.test.js
```

---

## Architecture Rules

### 1. MCP Server Entry (`src/server.js`)

Mirror viewcap/lightcap exactly:

- Import `McpServer` and `StdioServerTransport` from `@modelcontextprotocol/server`
- Import zod v4: `import * as z from 'zod/v4'`
- Register four tools via `server.registerTool(name, { description, inputSchema }, handler)`:
  - `get_contrast_summary`
  - `check_page_contrast`
  - `check_element_contrast`
  - `get_status`
- Manage a **single shared Playwright browser instance** — launch on first tool call, reuse across calls, close on process exit
- Listen for `SIGINT`/`SIGTERM` to close the browser cleanly
- Handler return shape: `{ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }` — MCP tools return text; stringify the JSON payload
- On error: run through `sanitizeError()` and return `{ content: [{ type: 'text', text: 'Error: <sanitized>' }] }` — never throw out of the handler
- Read `serverVersion` from `package.json` once at startup

```js
#!/usr/bin/env node
import { readFileSync } from 'fs';
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { checkPageContrast } from './tools/checkPageContrast.js';
import { checkElementContrast } from './tools/checkElementContrast.js';
import { getContrastSummary } from './tools/getContrastSummary.js';
import { closeBrowser } from './browser.js';
import { sanitizeError } from './utils/sanitizeError.js';
import { CONFIG, log, setVerbosity } from './config.js';

if (process.argv.includes('--verbose')) setVerbosity('verbose');
if (process.argv.includes('--quiet')) setVerbosity('quiet');

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const serverVersion = pkg.version;

const server = new McpServer({ name: 'contrastcap', version: serverVersion });

// … registerTool calls …

process.on('SIGINT',  async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });

console.error('[contrastcap] Server started — tools: get_contrast_summary, check_page_contrast, check_element_contrast, get_status');
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 2. Browser Lifecycle (`src/browser.js`)

```js
import { chromium } from 'playwright';
import { CONFIG, log } from './config.js';

let _browser = null;
let _launching = null; // de-dupe concurrent callers during initial launch

export async function getBrowser() {
  if (_browser) return _browser;
  if (_launching) return _launching;

  _launching = chromium.launch({
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      // Keep Chromium sandbox ON by default. Add --no-sandbox only on Linux
      // (matches lightcap's launch flags).
      ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ],
  }).then((b) => {
    _browser = b;
    _launching = null;
    log('info', 'Chromium launched');
    return b;
  }).catch((err) => {
    _launching = null;
    throw err;
  });

  return _launching;
}

export async function closeBrowser() {
  if (!_browser) return;
  try { await _browser.close(); } catch { /* ignore */ }
  _browser = null;
}

export async function withPage(fn) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: CONFIG.VIEWPORT_WIDTH, height: CONFIG.VIEWPORT_HEIGHT },
    deviceScaleFactor: 1, // we need actual CSS pixels, not retina
    userAgent: CONFIG.USER_AGENT,
  });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}
```

Each tool call opens a **fresh browser context + page** (via `withPage`), navigates, audits, then tears the context down. This avoids state leakage between calls (cookies, service workers, localStorage) while keeping the expensive browser process warm across calls.

### 3. URL Validation (`src/utils/urlValidate.js`)

Mirror lightcap's approach: scheme allowlist + explicit cloud-metadata hostname denylist + DNS-resolved IP-prefix denylist, with localhost explicitly allowed. **All error messages are generic** so the caller can't use the server as an SSRF-probe oracle.

```js
import { lookup } from 'dns/promises';
import { CONFIG } from '../config.js';

async function isBlockedIp(hostname) {
  if (CONFIG.LOCALHOST_HOSTS.includes(hostname)) return false;
  try {
    const { address } = await lookup(hostname);
    // Normalize IPv6-mapped IPv4: ::ffff:1.2.3.4 → 1.2.3.4
    const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
    return CONFIG.BLOCKED_IP_PREFIXES.some(p => normalized.startsWith(p));
  } catch {
    return true; // DNS failure → fail closed
  }
}

export async function validateUrl(url) {
  const parsed = new URL(url);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Blocked URL scheme');
  }
  if (CONFIG.BLOCKED_HOSTNAMES.includes(parsed.hostname)) {
    throw new Error('Blocked URL');
  }
  if (await isBlockedIp(parsed.hostname)) {
    throw new Error('Blocked URL');
  }
  return parsed.href;
}

export const _test = { isBlockedIp };
```

`CONFIG.BLOCKED_HOSTNAMES` and `CONFIG.BLOCKED_IP_PREFIXES` are copied verbatim from lightcap's `config.js` (the denylist covers AWS IMDS, GCP metadata, Azure metadata, `0.0.0.0`, full RFC1918 ranges, loopback, and IPv6 link-local/unique-local/unspecified). Localhost and RFC1918 IPs behind `localhost`-family hostnames are **allowed** — dev servers are the primary use case.

**Post-navigation re-check:** every tool handler calls `validateUrl(page.url())` after `page.goto` completes. A redirect to a metadata endpoint is rejected and the response discarded before pixel sampling.

---

## Engine Modules

### `engine/contrastCalc.js`

Exports: `relativeLuminance(hexColor)`, `contrastRatio(hex1, hex2)`, `meetsThreshold(ratio, isLargeText, level)`

```js
// Relative luminance per WCAG 2.1
export function relativeLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  
  const R = r <= 0.04045 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4;
  const G = g <= 0.04045 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4;
  const B = b <= 0.04045 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4;
  
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function contrastRatio(hex1, hex2) {
  const L1 = relativeLuminance(hex1);
  const L2 = relativeLuminance(hex2);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsThreshold(ratio, isLargeText, level = 'AA') {
  if (level === 'AAA') return isLargeText ? ratio >= 4.5 : ratio >= 7;
  return isLargeText ? ratio >= 3 : ratio >= 4.5; // AA
}
```

### `engine/pixelSampler.js`

Exports: `sampleBackgroundColor(page, element, boundingBox)`

This is the core module. Strategy:

1. Get element's `boundingBox` from Playwright
2. Get foreground color via `page.evaluate` → `getComputedStyle(el).color`
3. Make text transparent: `page.evaluate` → `el.style.color = 'transparent'`
4. Screenshot the bounding box region: `page.screenshot({ clip: boundingBox })`
5. Restore text color: `page.evaluate` → restore original color
6. Use `sharp` to read raw pixel buffer from the screenshot
7. Sample pixels on a 5×3 grid across the region
8. Compute median R, G, B across samples
9. Detect high variance (stddev > 15 on any channel) → flag as gradient/image background
10. For high-variance backgrounds:
    - Determine if foreground is light or dark (luminance > 0.5)
    - Light text: use the **darkest** sampled background (worst case)
    - Dark text: use the **lightest** sampled background (worst case)
11. Return `{ hex, source, highVariance }`

```js
import sharp from 'sharp';

export async function sampleBackgroundColor(page, elementHandle, box) {
  // Get original foreground color (resolved px-equivalent rgb)
  const fgColor = await elementHandle.evaluate(el => getComputedStyle(el).color);

  // Hide text to expose background. Save the prior inline value so we can
  // restore exactly — clearing inline style would lose any author-set inline color.
  await elementHandle.evaluate(el => {
    el.dataset._ccPrevInlineColor = el.style.color || '';
    el.style.color = 'transparent';
  });

  // Screenshot just this region
  const buffer = await page.screenshot({
    clip: { x: box.x, y: box.y, width: Math.max(box.width, 1), height: Math.max(box.height, 1) },
    type: 'png'
  });

  // Restore prior inline color (empty string clears it, matching pre-state)
  await elementHandle.evaluate(el => {
    el.style.color = el.dataset._ccPrevInlineColor || '';
    delete el.dataset._ccPrevInlineColor;
  });
  
  // Read pixels via sharp
  const { data, info } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  // Sample on 5x3 grid
  const samples = [];
  const cols = 5, rows = 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = Math.min(Math.floor((c + 0.5) * info.width / cols), info.width - 1);
      const py = Math.min(Math.floor((r + 0.5) * info.height / rows), info.height - 1);
      const idx = (py * info.width + px) * info.channels;
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }
  
  // Check variance
  const stddev = channel => {
    const vals = samples.map(s => s[channel]);
    const mean = vals.reduce((a, b) => a + b) / vals.length;
    return Math.sqrt(vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / vals.length);
  };
  
  const highVariance = stddev('r') > 15 || stddev('g') > 15 || stddev('b') > 15;
  
  let bgHex;
  if (highVariance) {
    // Worst-case: pick lightest or darkest sample depending on text color
    const fgLum = relativeLuminanceFromRgbString(fgColor);
    const sorted = samples.sort((a, b) => luminanceOf(a) - luminanceOf(b));
    // Light text on varied bg → use darkest bg pixel (worst contrast)
    // Dark text on varied bg → use lightest bg pixel (worst contrast)
    const worst = fgLum > 0.5 ? sorted[sorted.length - 1] : sorted[0];
    bgHex = rgbToHex(worst.r, worst.g, worst.b);
  } else {
    // Median color
    const median = channel => {
      const sorted = samples.map(s => s[channel]).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    bgHex = rgbToHex(median('r'), median('g'), median('b'));
  }
  
  return {
    hex: bgHex,
    source: highVariance ? 'pixel-sample-over-image' : 'pixel-sample',
    highVariance
  };
}
```

Note: `relativeLuminanceFromRgbString` must parse CSS `rgb(r, g, b)` or `rgba(r, g, b, a)` format. `luminanceOf({r,g,b})` computes luminance from 0-255 values. `rgbToHex(r,g,b)` converts to `#rrggbb`. Implement these as small helpers in the same file.

### `engine/axeRunner.js`

Exports: `runContrastAudit(page)`

1. Inject axe-core into the page via `page.evaluate`
2. Run with only contrast-related rules enabled: `color-contrast`
3. Return three arrays: `violations` (definite failures), `incomplete` (needs review), `passes`

```js
import axeCore from 'axe-core';

export async function runContrastAudit(page) {
  // Inject axe-core source
  await page.evaluate(axeSource => {
    const script = document.createElement('script');
    script.textContent = axeSource;
    document.head.appendChild(script);
  }, axeCore.source);
  
  // Run only color-contrast rule
  const results = await page.evaluate(async () => {
    return await window.axe.run(document, {
      runOnly: { type: 'rule', values: ['color-contrast'] },
      resultTypes: ['violations', 'incomplete', 'passes']
    });
  });
  
  // axe returns violations/incomplete/passes as arrays of *rules*, each with .nodes.
  // Flatten across rules — robust even if additional contrast-related rules are enabled later.
  const nodesOf = (arr) => (arr || []).flatMap(rule => rule.nodes || []);

  return {
    violations: nodesOf(results.violations),
    incomplete: nodesOf(results.incomplete),
    passes: nodesOf(results.passes)
  };
}
```

### `engine/colorSuggest.js`

Exports: `suggestFix(foregroundHex, backgroundHex, isLargeText, level)` — returns a **hex string only** (e.g. `"#595f64"`), never prose. Callers format human-readable messages on top of the hex.

Search HSL lightness in both directions (16-iteration binary search per direction) and return whichever candidate is closest to the original L (smallest change) while meeting the threshold. Preserves hue and saturation.

```js
export function suggestFix(fgHex, bgHex, isLargeText, level = 'AA') {
  const threshold = level === 'AAA'
    ? (isLargeText ? 4.5 : 7)
    : (isLargeText ? 3 : 4.5);

  const hsl = hexToHsl(fgHex);

  // Candidate A: darken — search [0, hsl.l] for the highest L that still meets threshold.
  //   Higher L = closer to original, so we want the max passing L in the darken range.
  const darken = findThresholdL(hsl, bgHex, 0, hsl.l, threshold, /* preferHigher */ true);

  // Candidate B: lighten — search [hsl.l, 100] for the lowest L that meets threshold.
  //   Lower L = closer to original in this range.
  const lighten = findThresholdL(hsl, bgHex, hsl.l, 100, threshold, /* preferHigher */ false);

  // Pick the candidate closest to the original L. Null candidates fall back to the other.
  if (darken && lighten) {
    return Math.abs(darken.l - hsl.l) <= Math.abs(lighten.l - hsl.l) ? darken.hex : lighten.hex;
  }
  return (darken || lighten)?.hex ?? (relativeLuminance(bgHex) > 0.5 ? '#000000' : '#ffffff');
}

function findThresholdL(hsl, bgHex, loInit, hiInit, threshold, preferHigher) {
  // Reject if neither endpoint meets threshold — no solution in this range.
  const hiHex = hslToHex(hsl.h, hsl.s, hiInit);
  const loHex = hslToHex(hsl.h, hsl.s, loInit);
  const hiPasses = contrastRatio(hiHex, bgHex) >= threshold;
  const loPasses = contrastRatio(loHex, bgHex) >= threshold;
  if (!hiPasses && !loPasses) return null;

  let lo = loInit, hi = hiInit;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    const ratio = contrastRatio(hslToHex(hsl.h, hsl.s, mid), bgHex);
    // preferHigher=true → we want the largest L that passes (darken range: max L still dark enough).
    // preferHigher=false → we want the smallest L that passes (lighten range: min L bright enough).
    if (preferHigher) {
      if (ratio >= threshold) lo = mid; else hi = mid;
    } else {
      if (ratio >= threshold) hi = mid; else lo = mid;
    }
  }
  const finalL = preferHigher ? lo : hi;
  return { l: finalL, hex: hslToHex(hsl.h, hsl.s, finalL) };
}
```

Include `hexToHsl` and `hslToHex` conversion helpers in this file.

### `utils/largeText.js`

```js
// fontSize MUST come from getComputedStyle(el).fontSize in the browser context —
// that always resolves to an absolute "NNpx" value regardless of the authored unit
// (em, rem, %, pt, etc.). Do NOT attempt to parse em/rem/pt server-side: em is
// relative to the *parent's* computed font size and cannot be resolved without
// the element context.
export function isLargeText(fontSizePx, fontWeight) {
  const px = typeof fontSizePx === 'number' ? fontSizePx : parseFloat(fontSizePx);
  const weight = parseInt(fontWeight) || 400;
  // Large text: >= 24px (18pt), or >= 18.66px (14pt) if bold (>= 700)
  return px >= 24 || (px >= 18.66 && weight >= 700);
}
```

### `utils/formatResults.js`

Shapes the final output for minimal token usage. Key rule: **passing elements are counted, not itemized.**

Callers pass an explicit `resolvedPassCount` — the number of elements that axe originally flagged as `incomplete` but that resolved to passing after pixel sampling. These are added to the `pass` count so the summary totals remain honest.

```js
export function formatPageResult({
  url,
  wcagLevel,
  axePassCount,         // passes.length from axe (original passes)
  resolvedPassCount,    // incomplete nodes that resolved to pass after pixel sampling
  skippedCount,         // elements that could not be resolved
  failures,             // Array<FailureEntry>
  warnings,             // Array<WarningEntry>
}) {
  const pass = axePassCount + resolvedPassCount;
  const total = pass + failures.length + warnings.length + skippedCount;

  return {
    url,
    timestamp: new Date().toISOString(),
    wcag_level: wcagLevel,
    summary: {
      total,
      pass,
      fail: failures.length,
      warning: warnings.length,
      skipped: skippedCount,
    },
    failures: failures.map(shapeEntry),
    warnings: warnings.map(shapeEntry),
  };
}

function shapeEntry(item) {
  const entry = {
    selector: truncate(item.selector, 120),
    text: truncate(item.text, 40),
    ratio: round(item.ratio, 2),
    required: item.required,
    level: item.level,
    fontSize: item.fontSize,
    fontWeight: item.fontWeight,
    isLargeText: item.isLargeText,
    foreground: item.foreground,
    background: item.background,
    backgroundSource: item.backgroundSource || 'computed',
  };
  // Suggestion is ALWAYS a hex string (e.g. "#595f64"). Callers format prose.
  if (item.suggestion) entry.suggestion = item.suggestion;
  if (item.note) entry.note = item.note;
  return entry;
}
```

`formatElementResult` mirrors this for single-element calls:

```js
export function formatElementResult({ url, wcagLevel, entry }) {
  return {
    url,
    timestamp: new Date().toISOString(),
    wcag_level: wcagLevel,
    selector: entry.selector,
    text: entry.text,
    ratio: round(entry.ratio, 2),
    required: entry.required,
    pass: entry.pass,
    fontSize: entry.fontSize,
    fontWeight: entry.fontWeight,
    isLargeText: entry.isLargeText,
    foreground: entry.foreground,
    background: entry.background,
    backgroundSource: entry.backgroundSource || 'computed',
    ...(entry.suggestion ? { suggestion: entry.suggestion } : {}),
    ...(entry.note ? { note: entry.note } : {}),
  };
}
```

---

## Tool Implementations

### `tools/getContrastSummary.js`

Input schema (zod):
```js
{
  url: z.string().describe('Page URL to audit (http/https, dev server or prod)'),
  level: z.enum(['AA', 'AAA']).default('AA').describe('WCAG conformance level. Defaults to AA.')
}
```

Steps:
1. Validate URL
2. Open page, navigate, wait for networkidle
3. Run `axeRunner.runContrastAudit(page)`
4. For each `incomplete` node, run pixel sampling + contrast calculation (same guards as `check_page_contrast` — skip on detached/shadow/zero-size/timeout)
5. Return counts only:

```json
{
  "url": "...",
  "timestamp": "...",
  "wcag_level": "AA",
  "counts": {
    "total_elements_checked": 52,
    "pass": 47,
    "fail": 3,
    "warning": 2,
    "skipped": 0
  }
}
```

`skipped` counts elements that could not be resolved — zero-size boxes, detached nodes, elements inside shadow DOM or cross-origin iframes, and per-element timeouts. These are tracked but not itemized in the summary output.

### `tools/checkPageContrast.js`

Input schema (zod):
```js
{
  url: z.string().describe('Page URL to audit (http/https, dev server or prod)'),
  level: z.enum(['AA', 'AAA']).default('AA').describe('WCAG conformance level. Defaults to AA. AAA must be explicitly requested.'),
  include_passes: z.boolean().default(false).describe('Include passing elements in output (increases token usage)')
}
```

Steps:
1. Validate URL
2. Open page, navigate, wait for networkidle
3. Run `axeRunner.runContrastAudit(page)`
4. Process definite `violations` — extract selector, text, colors, compute ratio, generate suggestion
5. For each `incomplete` node:
   a. Locate element via `page.$(selector)` — if not found (detached/shadow DOM/iframe), increment `skipped` and continue
   b. `await element.scrollIntoViewIfNeeded()` — screenshots of off-viewport elements return invalid clips
   c. Get bounding box, computed font size (px), computed font weight
   d. If `box.width * box.height < 4` (effectively hidden/zero-size), increment `skipped` and continue
   e. Wrap steps f–h in a 5s per-element timeout + try/catch; on failure, increment `skipped` and continue
   f. Call `pixelSampler.sampleBackgroundColor(page, element, box)`
   g. Compute contrast ratio against the sampled background
   h. Determine pass / fail / warning (warning: ratio within 0.3 of threshold, or `highVariance` background)
   i. Resolved passes bump the `pass` count (not itemized unless `include_passes`)
   j. If fail, generate color suggestion via `colorSuggest.suggestFix()`
6. Format with `formatResults.formatPageResult()`
7. Return JSON

### `tools/checkElementContrast.js`

Input schema (zod):
```js
{
  url: z.string().describe('Page URL (http/https, dev server or prod)'),
  selector: z.string().describe('CSS selector for the target element'),
  level: z.enum(['AA', 'AAA']).default('AA').describe('WCAG conformance level. Defaults to AA.')
}
```

Steps:
1. Validate URL
2. Open a fresh page via `withPage`, navigate with 30s timeout, wait for `networkidle`
3. Re-validate `page.url()` (post-redirect SSRF guard)
4. Find element via `page.$(selector)` — error if not found
5. `await element.scrollIntoViewIfNeeded()`
6. Get bounding box + computed styles (color, font-size in px, font-weight). If box is zero-size, return an error.
7. Run `pixelSampler.sampleBackgroundColor()`
8. Compute contrast ratio against the configured `level`
9. Determine pass/fail/warning; if fail, call `colorSuggest.suggestFix()` for a hex suggestion
10. Return a single-element result via `formatElementResult`:

```json
{
  "url": "...",
  "timestamp": "...",
  "wcag_level": "AA",
  "selector": "...",
  "text": "...",
  "ratio": 4.87,
  "required": 4.5,
  "pass": true,
  "fontSize": "16px",
  "fontWeight": "400",
  "isLargeText": false,
  "foreground": "#4a5258",
  "background": "#e9ecef",
  "backgroundSource": "pixel-sample"
}
```

If the element fails, `suggestion: "#rrggbb"` is added. If marginal or over a high-variance background, `note: "..."` is added.

---

## Timeouts & Limits

Enforced at three levels, matching the Security section of doc00:

| Scope | Limit | Where enforced |
|-------|-------|----------------|
| Page navigation | 30 000 ms | `page.goto(url, { timeout: CONFIG.NAV_TIMEOUT, waitUntil: 'networkidle' })` |
| Per-element pixel sampling | 5 000 ms | `Promise.race` inside the `incomplete`-node loop in `checkPageContrast.js` |
| Total audit | 120 000 ms | `Promise.race` wrapping the full tool handler body |
| Concurrent audits per process | 2 | Queue inside `src/server.js` (see lightcap's `enqueue()` pattern) |

On total-audit timeout the server returns `"Audit timed out"`; on per-element timeout the element is counted under `skipped` and the audit continues.

## Configuration via Environment Variables

```
CONTRASTCAP_NAV_TIMEOUT=30000      # Page navigation timeout ms
CONTRASTCAP_ELEMENT_TIMEOUT=5000   # Per-element pixel sampling timeout ms
CONTRASTCAP_AUDIT_TIMEOUT=120000   # Total audit cap ms
CONTRASTCAP_LEVEL=AA               # Default WCAG level (AA|AAA). AA is the default everywhere.
CONTRASTCAP_MAX_ELEMENTS=200       # Max elements to pixel-sample per page
CONTRASTCAP_VIEWPORT_WIDTH=1280    # Viewport width
CONTRASTCAP_VIEWPORT_HEIGHT=800    # Viewport height
CONTRASTCAP_MAX_CONCURRENT=2       # Max concurrent audits per process
```

Read via `process.env` with defaults in `src/config.js`. No dotenv dependency — environment variables are set in the Claude Desktop config or shell.

---

## Testing Checklist

### Unit Tests (Node.js test runner — `node --test`)

**contrastCalc.test.js:**
- [ ] `relativeLuminance('#ffffff')` returns `1.0`
- [ ] `relativeLuminance('#000000')` returns `0.0`
- [ ] `relativeLuminance('#808080')` returns approximately `0.2159`
- [ ] `contrastRatio('#000000', '#ffffff')` returns `21.0`
- [ ] `contrastRatio('#ffffff', '#ffffff')` returns `1.0`
- [ ] `contrastRatio('#767676', '#ffffff')` returns approximately `4.54` (classic AA boundary)
- [ ] `meetsThreshold(4.5, false, 'AA')` returns `true`
- [ ] `meetsThreshold(4.49, false, 'AA')` returns `false`
- [ ] `meetsThreshold(3.0, true, 'AA')` returns `true` (large text)
- [ ] `meetsThreshold(2.99, true, 'AA')` returns `false`

**pixelSampler.test.js:**
- [ ] Solid color background returns consistent hex with low variance
- [ ] High-variance input (mock gradient pixels) sets `highVariance: true`
- [ ] Worst-case selection: light text + varied bg → returns lightest bg pixel
- [ ] Worst-case selection: dark text + varied bg → returns darkest bg pixel
- [ ] Handles 1px × 1px bounding box without crashing
- [ ] Handles zero-size bounding box gracefully (returns error)

**colorSuggest.test.js:**
- [ ] `suggestFix('#6c757d', '#e9ecef', false, 'AA')` returns a hex with ratio ≥ 4.5 against `#e9ecef`
- [ ] `suggestFix('#ffffff', '#ffffff', false, 'AA')` returns a dark color (black or near-black)
- [ ] Suggested color is as close to original as possible (L delta is minimal)

### Integration Test

**integration.test.js:**
- [ ] Create a local HTML file with known contrast values
- [ ] Serve it via a simple HTTP server (e.g., `http.createServer`)
- [ ] Run `checkPageContrast` against it
- [ ] Verify known failures are detected with correct ratios (within ±0.1)
- [ ] Verify known passes are counted
- [ ] Verify suggestions produce valid hex colors that meet the threshold

### Manual Smoke Test

After build:
1. Start the server: `echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node src/index.js`
2. Verify three tools are listed
3. Configure in Claude Desktop
4. Ask Claude: "Check contrast on https://icjia.illinois.gov"
5. Verify structured results come back with failures, ratios, and suggestions

---

## Critical Implementation Notes

1. **axe-core injection**: Import `axe-core` as a dependency, read its `.source` property, inject via `page.evaluate`. Do NOT fetch from CDN.

2. **Selector extraction from axe results**: axe-core returns selectors in `node.target[0]`. These are CSS selector strings. Use them directly with `page.$()`.

3. **Text extraction**: `node.any[0]?.data?.fgColor` and `node.any[0]?.data?.bgColor` give axe's computed colors for definite violations. For incomplete nodes, we must pixel-sample.

4. **Element text**: Get via `element.evaluate(el => el.textContent?.trim()?.slice(0, 40))`.

5. **Race condition**: The color-transparent trick could flash on a visible browser. Since we're headless, this is invisible and safe.

6. **Viewport scrolling**: `element.scrollIntoViewIfNeeded()` before screenshotting. Elements below the fold won't have valid screenshot clips otherwise.

7. **Sharp pixel format**: `sharp(buffer).raw().toBuffer()` returns RGBA or RGB depending on input. Use `{ resolveWithObject: true }` and check `info.channels` (3 or 4).

8. **Timeout safety**: Wrap each element's pixel-sampling in a per-element try/catch with a 5-second timeout. Log skip, don't crash the whole audit.

---

## package.json

Mirrors viewcap/lightcap exactly — scoped package, ESM, `bin` entry, `files` whitelist for publish, MIT, ICJIA GitHub org.

```json
{
  "name": "@icjia/contrastcap",
  "version": "0.1.0",
  "description": "MCP server for automated WCAG contrast auditing via pixel-level analysis",
  "type": "module",
  "main": "src/server.js",
  "bin": { "contrastcap": "src/cli.js" },
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/*.test.js",
    "postinstall": "playwright install chromium --with-deps || playwright install chromium"
  },
  "files": ["src/", "README.md"],
  "engines": { "node": ">=20" },
  "keywords": ["mcp", "accessibility", "wcag", "contrast", "axe-core", "playwright", "claude"],
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/ICJIA/contrastcap-mcp.git" },
  "dependencies": {
    "@modelcontextprotocol/server": "^2.0.0-alpha.2",
    "axe-core": "^4.10.0",
    "commander": "^14.0.3",
    "playwright": "^1.49.0",
    "sharp": "^0.34.0",
    "zod": "^4.3.6"
  }
}
```

After `pnpm install`, `postinstall` will fetch Chromium. If the postinstall step fails (offline, CI), run `pnpm exec playwright install chromium` manually.

---

## README.md Content

Include:
- One-paragraph description
- Install steps (pnpm install, playwright install chromium)
- Claude Desktop config JSON block
- Tool descriptions with example inputs/outputs
- Environment variable table
- "How it works" section explaining the pixel-sampling approach
