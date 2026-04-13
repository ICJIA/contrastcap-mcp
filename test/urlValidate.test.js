import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateUrl, _test } from '../src/utils/urlValidate.js';

const { isBlockedIp } = _test;

describe('validateUrl', () => {
  it('allows http localhost', async () => {
    assert.equal(await validateUrl('http://localhost:3000'), 'http://localhost:3000/');
  });
  it('allows http 127.0.0.1', async () => {
    assert.equal(await validateUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080/');
  });
  it('allows https external URLs', async () => {
    assert.equal(await validateUrl('https://example.com'), 'https://example.com/');
  });

  it('blocks file:// scheme', async () => {
    await assert.rejects(() => validateUrl('file:///etc/passwd'), { message: 'Blocked URL scheme' });
  });
  it('blocks data: scheme', async () => {
    await assert.rejects(() => validateUrl('data:text/html,<h1>test</h1>'), { message: 'Blocked URL scheme' });
  });
  it('blocks javascript: scheme', async () => {
    await assert.rejects(() => validateUrl('javascript:alert(1)'), { message: 'Blocked URL scheme' });
  });
  it('blocks ftp:// scheme', async () => {
    await assert.rejects(() => validateUrl('ftp://example.com'), { message: 'Blocked URL scheme' });
  });

  it('blocks AWS metadata endpoint', async () => {
    await assert.rejects(() => validateUrl('http://169.254.169.254/'), { message: 'Blocked URL' });
  });
  it('blocks GCP metadata endpoint', async () => {
    await assert.rejects(() => validateUrl('http://metadata.google.internal/'), { message: 'Blocked URL' });
  });
  it('blocks Azure metadata endpoint', async () => {
    await assert.rejects(() => validateUrl('http://metadata.azure.com/'), { message: 'Blocked URL' });
  });
  it('blocks 0.0.0.0', async () => {
    await assert.rejects(() => validateUrl('http://0.0.0.0:8080/'), { message: 'Blocked URL' });
  });

  it('rejects non-URL strings', async () => {
    await assert.rejects(() => validateUrl('not-a-url'), { message: 'Invalid URL' });
  });
  it('rejects empty string', async () => {
    await assert.rejects(() => validateUrl(''), { message: 'Invalid URL' });
  });
  it('rejects oversized URL', async () => {
    const huge = 'http://example.com/' + 'a'.repeat(3000);
    await assert.rejects(() => validateUrl(huge), { message: 'Invalid URL' });
  });

  it('error messages never leak internal details', async () => {
    try { await validateUrl('file:///etc/shadow'); assert.fail('expected throw'); }
    catch (err) {
      assert.ok(!err.message.includes('/etc'));
      assert.ok(!err.message.includes('shadow'));
    }
  });
});

describe('isBlockedIp', () => {
  it('allows localhost', async () => {
    assert.equal(await isBlockedIp('localhost'), false);
  });
  it('allows 127.0.0.1', async () => {
    assert.equal(await isBlockedIp('127.0.0.1'), false);
  });
  it('allows ::1', async () => {
    assert.equal(await isBlockedIp('::1'), false);
  });
});
