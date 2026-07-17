import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { auditPage } from '../src/tools/auditPage.js';
import { closeBrowser } from '../src/browser.js';

// Regression: a page with a definite axe violation (solid low-contrast text)
// must not crash the audit. axe reports violation colors as hex strings
// ("#999999"), not rgb() — the audit previously died with "Invalid rgb string"
// on the first definite violation it tried to format.
const FIXTURE = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>e2e fixture</title></head>
<body style="margin:0">
  <p id="good" style="color:#000000;background:#ffffff;font-size:16px;padding:8px">Good contrast black on white</p>
  <p id="bad" style="color:#999999;background:#ffffff;font-size:14px;padding:8px">Low contrast gray on white</p>
  <div style="background:linear-gradient(90deg,#222222,#888888);padding:8px">
    <p id="grad" style="color:#ffffff;font-size:16px;margin:0">White text on wide dark gradient</p>
  </div>
</body>
</html>`;

describe('auditPage e2e (requires Chromium)', () => {
  let server;
  let url;

  before(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(FIXTURE);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/`;
  });

  after(async () => {
    await closeBrowser();
    await new Promise((resolve) => server.close(resolve));
  });

  it('completes on a page with a definite axe violation and reports it', async () => {
    const result = await auditPage(url, 'AA');

    const bad = result.failures.find(f => f.foreground === '#999999');
    assert.ok(bad, `expected a failure with foreground #999999, got: ${JSON.stringify(result.failures)}`);
    assert.equal(bad.background, '#ffffff');
    assert.ok(bad.ratio < 4.5, `expected failing ratio, got ${bad.ratio}`);
    assert.ok(/^#[0-9a-f]{6}$/.test(bad.suggestion), `expected hex suggestion, got ${bad.suggestion}`);

    // The pixel-sampling path must still resolve the gradient element too.
    const grad = result.failures.find(f => f.selector === '#grad');
    assert.ok(grad, 'expected the gradient element to be resolved via pixel sampling');
    assert.equal(grad.backgroundSource, 'pixel-sample-over-image');

    assert.equal(result.axePassCount >= 1, true, 'the good element should pass via axe');
  });
});
