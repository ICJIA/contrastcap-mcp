# Changelog

All notable changes to this project will be documented in this file.

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
