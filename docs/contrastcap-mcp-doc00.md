# contrastcap-mcp — Doc 00: Master Design Document

## Project Name

**contrastcap-mcp** — Local MCP server for automated WCAG 2.x contrast auditing via pixel-level analysis.

---

## Problem Statement

Axe-core (and by extension SiteImprove) flags many contrast violations as **"needs review"** — meaning it detected text over a complex background (gradient, image, semi-transparent overlay, inherited opacity) but cannot determine the actual rendered contrast ratio from the DOM alone. On a site with 1,860+ pages, "needs review" at scale becomes a blocking bottleneck.

The key insight: a headless browser has *already rendered the pixels*. The contrast information exists — axe-core just doesn't extract it. By screenshotting element regions and sampling actual pixel colors, we can resolve the majority of "needs review" items programmatically.

---

## Solution

A lightweight MCP server that:

1. Accepts any `http://` or `https://` URL — a live dev server (e.g., `http://localhost:3000`), a staging URL, or a public production deployment. No auth support in v1, so the page must be publicly reachable from the machine running the server.
2. Loads the page in headless Chromium via Playwright
3. Runs axe-core for an initial contrast pass (catches the easy violations)
4. For every element axe flags as **incomplete** (needs review), performs pixel-level contrast sampling
5. Returns a concise, structured report with pass/fail/warning per element

**Default WCAG level: AA.** AAA is available but must be explicitly requested via the `level` parameter on any tool call. AA is what SiteImprove flags against and what 99% of compliance work targets; AAA is opt-in to keep the default behavior aligned with real triage workflow.

---

## Architecture

```
Claude (MCP client)
  │
  ├── check_page_contrast(url)
  │     │
  │     ▼
  │   contrastcap-mcp (Node.js, stdio transport)
  │     │
  │     ├── Playwright (headless Chromium)
  │     │     ├── Navigate to URL
  │     │     ├── Inject & run axe-core (contrast rules only)
  │     │     └── For each "incomplete" element:
  │     │           ├── getBoundingClientRect()
  │     │           ├── Screenshot element region
  │     │           ├── Compute foreground color (getComputedStyle)
  │     │           ├── Sample background pixels from screenshot
  │     │           └── Calculate WCAG contrast ratio
  │     │
  │     └── Return structured JSON result
  │
  ├── check_element_contrast(url, selector)
  │     └── Same pipeline, scoped to one element
  │
  └── get_contrast_summary(url)
        └── Counts only — minimal tokens
```

### Transport

**stdio** — same as viewcap-mcp and lightcap-mcp. No HTTP server, no ports, no auth surface.

### Token Management Strategy

This is critical. A full-page audit could flag 50+ elements. Returning verbose data for every element would blow the context window.

**Default behavior:**
- `get_contrast_summary` returns *counts only* (e.g., "47 pass, 3 fail, 2 warning") — use this first
- `check_page_contrast` returns detail for **failures and warnings only** — passing elements are counted but not itemized
- Each failure record is compact: selector, ratio, required ratio, foreground hex, background hex, text snippet (truncated to 40 chars), bounding box

**Estimated token cost per tool call:**
- `get_contrast_summary`: ~50 tokens
- `check_page_contrast` (typical page, 3-5 failures): ~300-500 tokens
- `check_element_contrast`: ~80 tokens

---

## Tools

### 1. `get_contrast_summary`

Lightweight audit — returns counts only.

**Input:**
```json
{
  "url": "https://icjia.illinois.gov/about",
  "level": "AA"
}
```

`level` is optional and defaults to `"AA"`. `"AAA"` must be explicitly requested.

**Output:**
```json
{
  "url": "https://icjia.illinois.gov/about",
  "timestamp": "2026-04-13T14:30:00Z",
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

### 2. `check_page_contrast`

Full audit — returns detail for failures and warnings only.

**Input:**
```json
{
  "url": "https://icjia.illinois.gov/about",
  "level": "AA",
  "include_passes": false
}
```

**Output:**
```json
{
  "url": "https://icjia.illinois.gov/about",
  "timestamp": "2026-04-13T14:30:00Z",
  "wcag_level": "AA",
  "summary": { "total": 52, "pass": 47, "fail": 3, "warning": 2, "skipped": 0 },
  "failures": [
    {
      "selector": "nav.main-nav > ul > li:nth-child(3) > a",
      "text": "Grant Opportunities",
      "ratio": 3.21,
      "required": 4.5,
      "level": "AA",
      "fontSize": "14px",
      "fontWeight": "400",
      "isLargeText": false,
      "foreground": "#6c757d",
      "background": "#e9ecef",
      "backgroundSource": "pixel-sample",
      "suggestion": "#595f64"
    }
  ],
  "warnings": [
    {
      "selector": ".hero-banner h1",
      "text": "Illinois Criminal Justice Informat...",
      "ratio": 4.62,
      "required": 4.5,
      "level": "AA",
      "note": "Ratio is marginal (within 0.3 of threshold). Background sampled from image — may vary.",
      "foreground": "#ffffff",
      "background": "#5a7a91",
      "backgroundSource": "pixel-sample-over-image"
    }
  ]
}
```

### 3. `check_element_contrast`

Targeted single-element check. Useful for verifying a fix.

**Input:**
```json
{
  "url": "https://icjia.illinois.gov/about",
  "selector": "nav.main-nav > ul > li:nth-child(3) > a",
  "level": "AA"
}
```

`level` is optional and defaults to `"AA"`.

**Output:**
```json
{
  "url": "https://icjia.illinois.gov/about",
  "timestamp": "2026-04-13T14:30:00Z",
  "wcag_level": "AA",
  "selector": "nav.main-nav > ul > li:nth-child(3) > a",
  "text": "Grant Opportunities",
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

If the element is a failure, the output also includes `"suggestion": "#rrggbb"` — a hex color that meets the threshold with the smallest change from `foreground` in HSL lightness.

---

## Contrast Calculation

### WCAG 2.1 Relative Luminance

```
L = 0.2126 * R' + 0.7152 * G' + 0.0722 * B'

where for each channel C in {R, G, B}:
  c = C / 255
  C' = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4
```

### Contrast Ratio

```
ratio = (L_lighter + 0.05) / (L_darker + 0.05)
```

### WCAG AA Thresholds

| Text Type | Minimum Ratio |
|-----------|--------------|
| Normal text (< 18pt or < 14pt bold) | 4.5:1 |
| Large text (≥ 18pt or ≥ 14pt bold) | 3:1 |
| UI components & graphical objects | 3:1 |

### Large Text Detection

```
isLargeText = (fontSize >= 24px) || (fontSize >= 18.66px && fontWeight >= 700)
```

---

## Pixel Sampling Strategy

This is the core innovation — how we resolve "needs review" items.

### For solid/computed backgrounds (axe can already determine):
- Trust axe-core's result. No pixel sampling needed.

### For complex backgrounds (axe marks "incomplete"):

1. **Get the element's bounding box** via Playwright's `element.boundingBox()`
2. **Get foreground color** via `getComputedStyle(element).color` — this is reliable even when backgrounds aren't
3. **Scroll element into view** (`element.scrollIntoViewIfNeeded()`) — off-viewport elements don't produce valid screenshot clips
4. **Screenshot the element region** at 1x scale (no retina — we need actual CSS pixels)
5. **Sample background pixels (text-masked sampling):**
   - Save the prior inline `style.color` value, then set `el.style.color = 'transparent'` to hide the text
   - Screenshot the region (now showing only the background)
   - Restore the prior inline color
   - Sample a 5×3 grid of pixels across the region
   - Take the **median** color per channel (resistant to noise from adjacent elements and sub-pixel artifacts)

6. **Compute contrast ratio** from foreground RGB + sampled background RGB
7. **Flag as "warning" instead of "fail"** if:
   - The background sample has high variance (gradient or image)
   - The ratio is within 0.3 of the threshold (marginal)

> **Edge-sampling fallback (pseudo-elements, SVG text):** deferred to v2. The text-transparent trick is not ideal for `::before`/`::after` content or SVG `<text>` elements — in those cases axe often produces a solid-color result on its own anyway, and when it doesn't, we currently mark the element `skipped`. If real cases accumulate in triage, revisit with an edge-sampling implementation that reads pixels from an inward-offset perimeter.

### Handling Gradients

When pixel samples across the element region have high variance (stddev > 15 on any channel), the background is non-uniform. In this case:

- Use the **darkest sampled background pixel** for contrast against light text
- Use the **lightest sampled background pixel** for contrast against dark text
- This gives the **worst-case** contrast — the conservative approach for compliance

### Handling Background Images

Same as gradients — high variance triggers worst-case sampling. The `backgroundSource` field in the output indicates `"pixel-sample-over-image"` so the human reviewer knows this was heuristic.

---

## Color Suggestion Engine

When a failure is detected, the server suggests the **minimum color change** to achieve compliance. Hue and saturation are preserved — only lightness is adjusted.

1. Convert foreground to HSL
2. Search the **darken** range `[0, L]` for the highest L that still meets the threshold (16-iteration binary search)
3. Search the **lighten** range `[L, 100]` for the lowest L that meets the threshold (16-iteration binary search)
4. Return whichever candidate has the smaller `|ΔL|` from the original foreground — that is the minimum change
5. If neither direction yields a solution (e.g., foreground `#ffffff` on background `#ffffff`), fall back to `#000000` for a light background or `#ffffff` for a dark one
6. Convert the chosen HSL back to hex
7. Return as `suggestion` field (**hex string only**, e.g. `"#595f64"`) — the caller can format human-readable prose if needed

This gives the developer a concrete fix: `foreground: "#6c757d"` → `suggestion: "#595f64"`.

---

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js 20+ | Match viewcap-mcp / lightcap-mcp |
| Language | Plain ES-module JavaScript | No TypeScript — matches viewcap/lightcap convention |
| MCP SDK | `@modelcontextprotocol/server` (v2 alpha) | Same package viewcap and lightcap use |
| Transport | stdio | No network surface |
| Browser | Playwright (Chromium) | Already in the toolbox from a11yscan |
| Accessibility engine | axe-core | Industry standard; injected into the page, never reimplemented |
| Image processing | Sharp | Fast pixel access, already in the npm ecosystem |
| Schema validation | zod v4 | Same as viewcap/lightcap |
| Package manager | pnpm | Default stack preference |

---

## File Structure

```
contrastcap-mcp/
├── package.json
├── pnpm-lock.yaml
├── .env.example
├── README.md
├── src/
│   ├── index.js              # MCP server entry, tool registration
│   ├── tools/
│   │   ├── checkPageContrast.js
│   │   ├── checkElementContrast.js
│   │   └── getContrastSummary.js
│   ├── engine/
│   │   ├── contrastCalc.js    # WCAG luminance + ratio math
│   │   ├── pixelSampler.js    # Screenshot + pixel extraction
│   │   ├── colorSuggest.js    # Minimum-change fix suggestions
│   │   └── axeRunner.js       # Playwright + axe-core integration
│   └── utils/
│       ├── largeText.js       # Font size/weight → large text detection
│       └── formatResults.js   # Output shaping for token economy
└── tests/
    ├── contrastCalc.test.js
    ├── pixelSampler.test.js
    ├── colorSuggest.test.js
    └── integration.test.js
```

---

## Security Considerations

Minimal surface — this server reads web pages, nothing more.

1. **URL validation**: Reject `file://`, `javascript:`, `data:`, `ftp:` and other non-http(s) schemes. Allow `http://` and `https://` only. Private IPs (RFC1918) and loopback (`127.0.0.0/8`, `::1`) are **allowed** — localhost dev servers are the primary use case.
2. **Cloud metadata blocked**: Explicitly block hostnames `169.254.169.254`, `metadata.google.internal`, `metadata.azure.com`, and `0.0.0.0`, plus IPv4 prefix `169.254.` (link-local / AWS IMDS), IPv6 `fe80:` (link-local), `fd00:` (unique-local), and `::` (unspecified). DNS is resolved before the check so redirect-to-metadata attacks are caught.
3. **Post-navigation SSRF re-check**: After Playwright navigates, validate `page.url()` against the same rules — a redirect to a metadata endpoint is rejected, and the response is discarded.
4. **No credentials**: The server never stores or transmits auth tokens. If the target page requires auth, that's out of scope for v1.
5. **Playwright sandboxing**: Keep the Chromium sandbox on (do not pass `--no-sandbox` except on Linux CI, matching lightcap's pattern). Use `--disable-dev-shm-usage` for Docker compatibility.
6. **Timeouts**: 30s page load (`page.goto` timeout), 5s per-element pixel-sampling guard, 120s total audit cap (enforced via `Promise.race` in tool handlers).
7. **Concurrency limit**: At most 2 concurrent audits per process (matches lightcap). Requests beyond the cap return a "queue full" error rather than blocking indefinitely.
8. **No file writes**: The server never writes to disk. Screenshots are in-memory `Buffer` objects consumed by `sharp` and discarded.
9. **Sanitized error messages**: Internal stack traces, filesystem paths, and Playwright internals are never returned to the MCP client. A `sanitizeError()` helper maps known conditions to short human-readable strings and replaces everything else with `"Audit failed"`.

---

## Configuration

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "contrastcap": {
      "command": "node",
      "args": ["/path/to/contrastcap-mcp/src/index.js"],
      "env": {
        "CONTRASTCAP_TIMEOUT": "30000",
        "CONTRASTCAP_LEVEL": "AA"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTRASTCAP_TIMEOUT` | `30000` | Page load timeout in ms |
| `CONTRASTCAP_LEVEL` | `AA` | Default WCAG level (AA or AAA) |
| `CONTRASTCAP_MAX_ELEMENTS` | `200` | Max elements to pixel-sample per page |
| `CONTRASTCAP_VIEWPORT_WIDTH` | `1280` | Viewport width for rendering |
| `CONTRASTCAP_VIEWPORT_HEIGHT` | `800` | Viewport height for rendering |

---

## Workflow: Typical SiteImprove Triage Session

1. SiteImprove flags `icjia.illinois.gov/about` with 5 contrast issues, 3 marked "needs review"
2. Ask Claude: *"Check contrast on https://icjia.illinois.gov/about"*
3. Claude calls `get_contrast_summary` first (50 tokens)
4. If failures exist, Claude calls `check_page_contrast` (300 tokens)
5. Claude reports: "3 failures. Nav link 'Grant Opportunities' has 3.21:1 ratio — needs #595f64 or darker. Hero banner heading is marginal at 4.62:1 — technically passes but flag for design review."
6. You fix the nav link color in CSS
7. Ask Claude: *"Re-check that nav link on localhost:3000/about"*
8. Claude calls `check_element_contrast` with the selector (80 tokens)
9. "Now 4.87:1 — passes AA."

Total context cost for the full triage: **~430 tokens** of tool output.

---

## Out of Scope (v1)

- **Authentication**: No cookie/session support for gated pages
- **Crawling**: Single-page only. Use a11yscan for multi-page crawls.
- **Focus/hover states**: Only checks default rendered state
- **Dark mode**: Only checks the mode the page loads in
- **Non-text contrast**: UI components and graphical objects (future enhancement)
- **Shadow DOM / iframes**: axe-core can traverse shadow roots, but pixel sampling via `page.$()` does not pierce shadow boundaries or cross-origin iframes. Elements inside shadow DOM or iframes are skipped from pixel resolution and reported in the `skipped` count.
- **PDF contrast**: Not applicable — web pages only

---

## Future Enhancements (v2+)

- State-based checking (hover, focus, active) via Playwright state emulation
- Dark mode toggle via `prefers-color-scheme` media override
- Batch URL mode (accept array of URLs, return combined report)
- Integration with a11yscan for crawl-then-audit pipeline
- Non-text contrast checking (borders, icons, form controls)

---

## Document Suite

| Doc | Title | Status |
|-----|-------|--------|
| 00 | Master Design Document | ✅ This document |
| 07 | LLM Build Prompt | Next |

This is a focused two-document project. The server is small enough (6 source files + 4 test files) that a full 13-doc suite would be overhead. The build prompt (Doc 07) is the deliverable.
