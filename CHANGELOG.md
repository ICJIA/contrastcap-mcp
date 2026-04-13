# Changelog

All notable changes to this project will be documented in this file.

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
