import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const MOD = new URL('../src/tools/auditPage.js', import.meta.url).href;

function runChild(script, env = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    timeout: 15_000,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('withAuditTimeout', () => {
  it('does not keep the process alive after the audited promise resolves', () => {
    // Regression: the timeout timer was never cleared, so the CLI lingered
    // for the full AUDIT_TIMEOUT (120s) after printing results. The child
    // must exit on its own — a SIGTERM here means spawnSync had to kill it.
    const r = runChild(`
      const { withAuditTimeout } = await import(${JSON.stringify(MOD)});
      console.log(await withAuditTimeout(Promise.resolve('ok')));
    `);
    assert.equal(r.stdout.trim(), 'ok');
    assert.equal(r.signal, null, 'child was killed — a leaked audit timer kept the event loop alive');
    assert.equal(r.status, 0);
  });

  it('still rejects with the label message when the promise outlasts the timeout', () => {
    const r = runChild(`
      const { withAuditTimeout } = await import(${JSON.stringify(MOD)});
      await withAuditTimeout(new Promise(() => {})).catch(e => console.log(e.message));
    `, { CONTRASTCAP_AUDIT_TIMEOUT: '200' });
    assert.equal(r.stdout.trim(), 'Audit timed out');
    assert.equal(r.signal, null);
    assert.equal(r.status, 0);
  });
});
