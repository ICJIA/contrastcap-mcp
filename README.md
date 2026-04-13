# @icjia/contrastcap

**MCP server for automated WCAG contrast auditing via pixel-level analysis.**

`contrastcap` resolves the "needs review" gap that axe-core and SiteImprove leave behind. When text sits over a complex background (gradient, image, semi-transparent overlay), axe can't determine the rendered contrast ratio from the DOM alone and marks the element `incomplete`. `contrastcap` loads the page in headless Chromium, screenshots the element region with the text hidden, samples actual rendered pixels, and returns a decisive pass / fail / warning with a concrete hex color suggestion for failures.

Built for the same triage workflow as `@icjia/lightcap` and `@icjia/viewcap` — stdio transport, ESM, minimal token footprint, `get_status` tool, `publish.sh`.

---

## Install

```bash
pnpm install
# Playwright's Chromium is fetched automatically via postinstall.
# If that fails (offline, CI), run manually:
pnpm exec playwright install chromium
```

Requires Node 20+.

## Claude Desktop / Claude Code configuration

Add to `claude_desktop_config.json` (or your IDE's MCP config):

```json
{
  "mcpServers": {
    "contrastcap": {
      "command": "npx",
      "args": ["-y", "@icjia/contrastcap"]
    }
  }
}
```

Or, pointing at a local checkout:

```json
{
  "mcpServers": {
    "contrastcap": {
      "command": "node",
      "args": ["/absolute/path/to/contrastcap-mcp/src/server.js"]
    }
  }
}
```

Restart Claude to pick up the new server.

---

## Tools

All four tools default to **WCAG AA**. `AAA` must be explicitly requested via `level: "AAA"`.

### `get_contrast_summary`

Counts only — the cheapest token footprint. Use this first to decide whether a full audit is warranted.

```json
{ "url": "https://example.com/about" }
```

Returns:

```json
{
  "url": "https://example.com/about",
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

### `check_page_contrast`

Full page audit. Returns detail for failures and warnings only — passing elements are counted, not itemized.

```json
{ "url": "https://example.com/about", "level": "AA" }
```

Returns:

```json
{
  "url": "...",
  "timestamp": "...",
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
      "text": "Criminal Justice Information…",
      "ratio": 4.62,
      "required": 4.5,
      "level": "AA",
      "foreground": "#ffffff",
      "background": "#5a7a91",
      "backgroundSource": "pixel-sample-over-image",
      "note": "Ratio within 0.3 of threshold — marginal. Background sampled from gradient or image — may vary at other positions."
    }
  ]
}
```

**Suggestion format is always hex** (e.g. `"#595f64"`). The caller formats prose.

### `check_element_contrast`

Single-element check. Use this to verify a fix without re-running the full page audit.

```json
{
  "url": "http://localhost:3000/about",
  "selector": "nav.main-nav > ul > li:nth-child(3) > a"
}
```

Returns a single-element object with `pass: true|false`, the measured `ratio`, `foreground`, `background`, and a `suggestion` hex if failing.

### `get_status`

Server + axe-core + Playwright versions, plus a non-blocking npm update check.

---

## How it works

1. Playwright navigates to the URL (30s timeout, `networkidle` fallback to `load`).
2. The server re-validates `page.url()` against the SSRF denylist (redirect guard).
3. axe-core is injected via `page.evaluate` and run with `color-contrast` only. Its `violations` (definite failures) and `passes` (definite passes) are trusted as-is.
4. For every `incomplete` (needs-review) node:
   - Scroll into view
   - Read computed `color`, `fontSize` (always resolved to px), `fontWeight`
   - Save the element's prior inline `color`, set it to `transparent`, screenshot the bounding box, then restore
   - Decode pixels via `sharp`, sample on a 5×3 grid
   - If per-channel stddev > 15, treat as gradient/image and use worst-case pixel (darkest on light text, lightest on dark text)
   - Otherwise take the median per channel
   - Compute the WCAG 2.1 ratio and compare against the required threshold
5. For failures, compute a hex color suggestion via 16-iteration HSL-lightness binary search in both directions; return whichever candidate has the smaller `|ΔL|` from the original foreground.
6. Passes bump the `pass` count. Marginal passes or high-variance backgrounds are flagged as warnings, not failures.

### Limits & timeouts

| Scope | Limit |
|-------|-------|
| Page navigation | 30 s |
| Per-element pixel sampling | 5 s (skipped on timeout, audit continues) |
| Total audit | 120 s (returns `Audit timed out`) |
| Max elements pixel-sampled per page | 200 |
| Concurrent audits per process | 2 (queue-full error beyond that) |

### What's out of scope (v1)

- Authenticated pages (no cookie/session handling)
- Multi-page crawling (use `a11yscan` for that)
- Focus/hover state contrast
- Dark-mode toggling
- Non-text contrast (UI components, graphical objects)
- Elements inside shadow DOM or cross-origin iframes (counted under `skipped`)
- PDF contrast

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONTRASTCAP_NAV_TIMEOUT` | `30000` | Page navigation timeout (ms) |
| `CONTRASTCAP_ELEMENT_TIMEOUT` | `5000` | Per-element pixel sampling timeout (ms) |
| `CONTRASTCAP_AUDIT_TIMEOUT` | `120000` | Total audit cap (ms) |
| `CONTRASTCAP_LEVEL` | `AA` | Default WCAG level (`AA` or `AAA`) |
| `CONTRASTCAP_MAX_ELEMENTS` | `200` | Max elements to pixel-sample per page |
| `CONTRASTCAP_MAX_CONCURRENT` | `2` | Max concurrent audits per process |
| `CONTRASTCAP_VIEWPORT_WIDTH` | `1280` | Chromium viewport width |
| `CONTRASTCAP_VIEWPORT_HEIGHT` | `800` | Chromium viewport height |

---

## CLI

The package also exposes a CLI for local use without an MCP client:

```bash
npx @icjia/contrastcap summary  https://example.com/about
npx @icjia/contrastcap page     https://example.com/about --level AAA
npx @icjia/contrastcap element  http://localhost:3000 'nav a'
npx @icjia/contrastcap status
```

With no subcommand, the binary starts the MCP server on stdio.

---

## Publishing

`./publish.sh` mirrors the pattern used by `@icjia/lightcap` and `@icjia/viewcap`:

```bash
./publish.sh              # bump patch version and publish (default)
./publish.sh minor        # bump minor version and publish
./publish.sh major        # bump major version and publish
./publish.sh --dry-run    # dry run only, no publish
```

First-time publish is auto-detected (no existing version on npm) — the current `package.json` version is used as-is. Subsequent releases bump + tag + push.

---

## Security

- Scheme allowlist: `http:` and `https:` only. `file:`, `javascript:`, `data:`, `ftp:` etc. are rejected with a generic `Blocked URL scheme` error.
- Cloud-metadata hostnames blocked: `169.254.169.254`, `metadata.google.internal`, `metadata.azure.com`, `0.0.0.0`.
- IP-prefix denylist (DNS-resolved): IPv4 link-local (`169.254.`), IPv6 unique-local (`fd00:`), link-local (`fe80:`), unspecified (`::`). DNS-resolution failures fail closed.
- Post-navigation re-check: after `page.goto` settles, `page.url()` is re-validated before any pixel sampling.
- Generic error messages — no filesystem paths or stack traces are returned to MCP clients.
- No file writes. Screenshots are in-memory buffers consumed by `sharp` and discarded.

Private / localhost IPs are **allowed** by design — the primary use case is auditing dev servers.

---

## License

MIT © 2026 Illinois Criminal Justice Information Authority (ICJIA)
