# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed
- **AAA audits under-reported.** axe was always run with the `color-contrast`
  rule, which checks WCAG AA (1.4.3) thresholds only — elements passing AA
  but failing AAA (e.g. `#767676` on white, 4.54:1 against a 7:1 bar) were
  trusted as passes. `level: "AAA"` now runs axe's `color-contrast-enhanced`
  rule (1.4.6). Relatedly, the enhanced rule files elements whose background
  it cannot determine under `passes` with `contrastRatio: null` (the AA rule
  marks the same elements `incomplete`); ratio-less passes are no longer
  trusted and go through pixel resolution like any needs-review node.
- **CLI lingered up to 120 s after printing results.** The audit-timeout and
  per-element timers raced via `Promise.race` were never cleared, pinning the
  event loop until they fired. New `raceWithTimeout()` clears the timer as
  soon as either side settles; the process now exits as soon as output is
  flushed.

### Tests
- e2e now covers AAA: the 4.54:1 element must fail at 7:1 and the gradient
  element must be pixel-resolved to a failure at AAA.
- New process-level regression test asserts a child that awaits
  `withAuditTimeout(Promise.resolve())` exits on its own. 98 tests, all
  passing.

## [0.1.6] — 2026-07-17

### Fixed
- **Audits crashed on any page with a definite axe violation.** axe-core
  reports violation colors as hex strings (`Color.toHexString()` →
  `"#999999"`), but the failure formatter parsed them with the `rgb()`-only
  parser, which throws `Invalid rgb string` — and the violations loop had no
  error isolation, so a single definite violation aborted the whole audit
  with `Audit failed`. Since most real pages have at least one definite
  contrast violation, `check_page_contrast` and `get_contrast_summary`
  failed on most real-world input. The pixel-sampling path for
  "needs review" nodes reads colors from `getComputedStyle` (`rgb()` form)
  and was unaffected — which is why gradient-focused testing missed it.
  **Fix:** new `cssColorToHex()` accepts both hex and `rgb()`/`rgba()`
  forms at every point colors enter the pipeline, and a malformed violation
  node now counts as `skipped` instead of killing the audit.
- **CSP-hardened pages.** axe-core is injected via CDP `Runtime.evaluate`
  instead of a DOM `<script>` tag, so a page CSP (`script-src` without
  `unsafe-inline`) can no longer block the audit. (Committed after 0.1.5;
  first shipped in this release.)

### Tests
- New Chromium-backed e2e regression test (`test/auditPage.e2e.test.js`):
  serves a fixture with a definite violation + a gradient "needs review"
  element and asserts the audit completes and reports both. 95 tests, all
  passing.

## [0.1.5] — 2026-07-01

### Fixed
- **Server failed to start under `npx` (MCP SDK prerelease drift).** `npx -y @icjia/contrastcap` crashed on startup with `SyntaxError: The requested module '@modelcontextprotocol/server' does not provide an export named 'StdioServerTransport'`, surfacing in Claude Code as `Failed to reconnect to contrastcap: -32000`. The dependency was pinned with a caret on a **prerelease** (`"@modelcontextprotocol/server": "^2.0.0-alpha.2"`) and the published tarball ships no lockfile, so every fresh `npx` install re-resolved that range to the newest matching prerelease. `2.0.0-alpha.3` moved `StdioServerTransport` from the package root to the `@modelcontextprotocol/server/stdio` subpath, so `src/server.js`'s root import stopped resolving. **Fix:** pin the SDK to exactly `2.0.0-alpha.2` (never range a prerelease). Existing npx installs must clear the cache to pick this up: `rm -rf ~/.npm/_npx`.

## [0.1.4] — 2026-04-13

Security audit (red/blue team) and hardening pass. No exploitable issues
were found in the published code, but several attack surfaces were
tightened. `pnpm audit`: 0 vulnerabilities.

### Security
- **SSRF: CIDR-based IP classification.** Replaced the prefix-string IP
  denylist with proper CIDR classification (`net.isIP` + range checks).
  Always-blocked categories now include IPv4 link-local (`169.254.0.0/16`,
  catches all of AWS IMDS, not just the literal address), IPv6 link-local
  (`fe80::/10`), IPv6 multicast (`ff00::/8`), IPv4 multicast/reserved
  (`224.0.0.0/4`+), and unspecified (`0.0.0.0`, `::`). IPv4-mapped IPv6
  addresses (`::ffff:169.254.169.254`) are unwrapped before classification
  so they cannot bypass the link-local check. Closes the SSRF gap an
  attacker-controlled HTTP redirect could otherwise exploit
  (`http://evil/` → `http://[::ffff:169.254.169.254]/`).
- **SSRF: opt-in private/loopback blocking.** New `CONTRASTCAP_BLOCK_PRIVATE=1`
  env flag blocks RFC1918 (`10/8`, `172.16/12`, `192.168/16`), CGNAT
  (`100.64/10`), loopback (`127/8`, `::1`), and IPv6 ULA (`fc00::/7`). Off
  by default to preserve the documented dev-server workflow; recommended
  on when running the server in a trusted internal network.
- **Selector hardening.** `check_element_contrast` now rejects Playwright
  engine prefixes (`xpath=`, `text=`, `role=`, `internal:*`, `_react=`,
  `_vue=`, etc.) and chain operators (`>>`/`>>>`). Prevents a malicious
  caller from using a selector to pivot from CSS into XPath /
  text-content matching to exfiltrate DOM text via the returned
  `text:` field.
- **Postinstall hardening.** Replaced the inline `node -e
  execSync('playwright install chromium') ... process.exit(0)` with
  `scripts/postinstall.mjs`, which (1) resolves Playwright's CLI via
  `require.resolve('playwright/cli.js')` instead of `$PATH` (closes the
  shadowed-binary hijack vector), (2) honors
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, and (3) emits actionable error
  messages on failure instead of a silent broken install.
- **Runtime browser preflight.** `getBrowser()` now translates
  Playwright's "Executable doesn't exist" error into a one-line
  remediation message pointing at `npx playwright install chromium`
  rather than a Playwright-internal stack trace.

### Documentation
- README **Security** section rewritten with explicit threat model,
  control catalog, and a pointer to the audit history.
- Three new env vars documented (`CONTRASTCAP_BLOCK_PRIVATE`,
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`, `PLAYWRIGHT_DOWNLOAD_HOST`).

### Tests
- `test/urlValidate.test.js` rewritten to cover the full CIDR matrix
  (RFC1918 boundaries, CGNAT, IPv4-mapped IPv6, IPv6 link-local /
  multicast, IPv4 multicast) and both default and
  `CONTRASTCAP_BLOCK_PRIVATE=1` policies.
- New `test/selectorValidate.test.js` covers Playwright engine-prefix
  rejection plus a positive set of plain-CSS selectors that must keep
  working (including the CSS child combinator `>`).
- 89 tests, all passing.

## [0.1.2] — 2026-04-13

Skipped — superseded by 0.1.3 before publish (`publish.sh` auto-bumped
after the pre-bump to 0.1.2).

## [0.1.3] — 2026-04-13

### Fixed
- `get_status` now reports accurate `axe-core` and `playwright` versions regardless of install layout (flat npm, pnpm, npx cache). Previously reported `vunknown` when installed via `npx`. Uses `createRequire` + `require.resolve` to locate each dependency's `package.json` through Node's module resolver rather than a hardcoded relative path.

## [0.1.1] — 2026-04-13

First installable release. Functionally identical to the un-published 0.1.0 — version bumped only because `0.1.0` was reserved on the registry.

## [0.1.0] — 2026-04-13

Initial release.

### Added
- `get_contrast_summary` — counts-only audit (pass / fail / warning / skipped), lowest token cost.
- `check_page_contrast` — full page audit with failure/warning detail and hex color suggestions.
- `check_element_contrast` — single-element check for verifying fixes.
- `get_status` — server/axe-core/Playwright versions + npm update check.
- Pixel-level background sampling for axe-core `incomplete` (needs-review) nodes via text-transparent screenshot + sharp.
- Worst-case sampling over high-variance backgrounds (gradients, images).
- HSL-lightness binary-search color suggestion engine (16 iterations each direction; preserves hue/saturation).
- WCAG AA default; AAA opt-in via `level: "AAA"`.
- URL validation with scheme allowlist, cloud-metadata denylist, DNS-resolved IP-prefix denylist.
- Post-navigation SSRF re-check.
- Per-element (5s) + total-audit (120s) + navigation (30s) timeouts.
- Concurrency cap (2 audits per process).
- CLI: `contrastcap summary|page|element|status <url>`.
- Test suite via `node --test`: contrast math, color-suggest engine, large-text detection, URL validation.
