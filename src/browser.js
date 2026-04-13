import { chromium } from 'playwright';
import { CONFIG, log } from './config.js';

let _browser = null;
let _launching = null;

export async function getBrowser() {
  if (_browser) return _browser;
  if (_launching) return _launching;

  _launching = chromium.launch({
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--no-first-run',
      '--no-default-browser-check',
      ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ],
  }).then((b) => {
    _browser = b;
    _launching = null;
    log('info', 'Chromium launched');
    return b;
  }).catch((err) => {
    _launching = null;
    if (/Executable doesn't exist|browserType\.launch/i.test(err.message || '')) {
      throw new Error(
        "Chromium is not installed. Run `npx playwright install chromium` " +
        "to download it (~200 MB), or set PLAYWRIGHT_DOWNLOAD_HOST to a mirror."
      );
    }
    throw err;
  });

  return _launching;
}

export async function closeBrowser() {
  if (!_browser) return;
  try { await _browser.close(); } catch { /* ignore */ }
  _browser = null;
}

/**
 * Open a fresh context + page, run `fn`, then tear it down.
 * Context is disposable per call to avoid state leaks between audits.
 */
export async function withPage(fn) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: CONFIG.VIEWPORT_WIDTH, height: CONFIG.VIEWPORT_HEIGHT },
    deviceScaleFactor: 1, // pixel sampling needs CSS pixels, not retina
    userAgent: CONFIG.USER_AGENT,
  });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await context.close().catch(() => { /* ignore */ });
  }
}
