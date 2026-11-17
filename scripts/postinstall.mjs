// Resolve Playwright's CLI through Node's module resolver (not $PATH) and
// invoke it directly. Failure is reported but does not abort the parent
// install — Chromium download can fail for legitimate reasons (offline CI,
// air-gapped network, restricted egress). Users who hit that get a clear
// error pointing to the manual fix instead of a silent broken install at
// audit time.
//
// Skip download entirely:
//   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
// Use a private mirror:
//   PLAYWRIGHT_DOWNLOAD_HOST=https://mirror.example.com

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1') {
  console.error('[contrastcap] PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 — skipping Chromium install.');
  process.exit(0);
}

const require = createRequire(import.meta.url);

// Resolve via each package's package.json (always exported) and take the
// cli.js beside it. Newer Playwright releases don't list './cli.js' in their
// "exports" map, so require.resolve('playwright/cli.js') throws
// ERR_PACKAGE_PATH_NOT_EXPORTED under every package manager, and under pnpm
// playwright-core isn't resolvable from here at all.
function cliBeside(pkg) {
  return join(dirname(require.resolve(`${pkg}/package.json`)), 'cli.js');
}

let cliPath;
try {
  cliPath = cliBeside('playwright');
  if (!existsSync(cliPath)) throw new Error(`${cliPath} not found`);
} catch {
  try {
    cliPath = cliBeside('playwright-core');
    if (!existsSync(cliPath)) throw new Error(`${cliPath} not found`);
  } catch (err) {
    console.error('[contrastcap] could not resolve Playwright CLI:', err.message);
    console.error('[contrastcap] run `npx playwright install chromium` manually before first audit.');
    process.exit(0);
  }
}

const result = spawnSync(process.execPath, [cliPath, 'install', 'chromium'], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('[contrastcap] playwright install chromium failed to spawn:', result.error.message);
  console.error('[contrastcap] run `npx playwright install chromium` manually before first audit.');
  process.exit(0);
}

if (result.status !== 0) {
  console.error(`[contrastcap] playwright install chromium exited with status ${result.status}.`);
  console.error('[contrastcap] run `npx playwright install chromium` manually before first audit.');
  // Do not propagate non-zero — install can complete; runtime will surface a
  // helpful error if Chromium is genuinely missing.
  process.exit(0);
}
