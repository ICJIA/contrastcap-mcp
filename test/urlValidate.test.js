import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateUrl, _test } from '../src/utils/urlValidate.js';

const { classifyIp } = _test;

describe('validateUrl (default policy: private/loopback allowed)', () => {
  before(() => { delete process.env.CONTRASTCAP_BLOCK_PRIVATE; });

  it('allows http localhost', async () => {
    assert.equal(await validateUrl('http://localhost:3000'), 'http://localhost:3000/');
  });
  it('allows http 127.0.0.1', async () => {
    assert.equal(await validateUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080/');
  });
  it('allows https external URLs', async () => {
    assert.equal(await validateUrl('https://example.com'), 'https://example.com/');
  });
  it('allows RFC1918 10/8 by default', async () => {
    assert.equal(await validateUrl('http://10.0.0.5/'), 'http://10.0.0.5/');
  });
  it('allows RFC1918 192.168/16 by default', async () => {
    assert.equal(await validateUrl('http://192.168.1.1/'), 'http://192.168.1.1/');
  });
  it('allows CGNAT 100.64/10 by default', async () => {
    assert.equal(await validateUrl('http://100.64.0.1/'), 'http://100.64.0.1/');
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

  it('blocks AWS metadata endpoint (link-local CIDR)', async () => {
    await assert.rejects(() => validateUrl('http://169.254.169.254/'), { message: 'Blocked URL' });
  });
  it('blocks any 169.254.x.x address (link-local)', async () => {
    await assert.rejects(() => validateUrl('http://169.254.1.1/'), { message: 'Blocked URL' });
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
  it('blocks IPv4-mapped IPv6 link-local', async () => {
    await assert.rejects(() => validateUrl('http://[::ffff:169.254.169.254]/'), { message: 'Blocked URL' });
  });
  it('blocks IPv6 unspecified ::', async () => {
    await assert.rejects(() => validateUrl('http://[::]/'), { message: 'Blocked URL' });
  });
  it('blocks IPv6 link-local fe80::', async () => {
    await assert.rejects(() => validateUrl('http://[fe80::1]/'), { message: 'Blocked URL' });
  });
  it('blocks IPv6 multicast ff02::', async () => {
    await assert.rejects(() => validateUrl('http://[ff02::1]/'), { message: 'Blocked URL' });
  });
  it('blocks IPv4 multicast (224+)', async () => {
    await assert.rejects(() => validateUrl('http://224.0.0.1/'), { message: 'Blocked URL' });
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

describe('validateUrl (CONTRASTCAP_BLOCK_PRIVATE=1 — private blocked)', () => {
  before(() => { process.env.CONTRASTCAP_BLOCK_PRIVATE = '1'; });
  after(()  => { delete process.env.CONTRASTCAP_BLOCK_PRIVATE; });

  it('blocks 127.0.0.1', async () => {
    await assert.rejects(() => validateUrl('http://127.0.0.1/'), { message: 'Blocked URL' });
  });
  it('blocks 127.1.2.3 (full /8)', async () => {
    await assert.rejects(() => validateUrl('http://127.1.2.3/'), { message: 'Blocked URL' });
  });
  it('blocks 10.0.0.5', async () => {
    await assert.rejects(() => validateUrl('http://10.0.0.5/'), { message: 'Blocked URL' });
  });
  it('blocks 172.16.0.1', async () => {
    await assert.rejects(() => validateUrl('http://172.16.0.1/'), { message: 'Blocked URL' });
  });
  it('blocks 172.31.255.255 (top of /12)', async () => {
    await assert.rejects(() => validateUrl('http://172.31.255.255/'), { message: 'Blocked URL' });
  });
  it('allows 172.32.0.1 (just outside /12)', async () => {
    assert.equal(await validateUrl('http://172.32.0.1/'), 'http://172.32.0.1/');
  });
  it('blocks 192.168.1.1', async () => {
    await assert.rejects(() => validateUrl('http://192.168.1.1/'), { message: 'Blocked URL' });
  });
  it('blocks CGNAT 100.64.0.1', async () => {
    await assert.rejects(() => validateUrl('http://100.64.0.1/'), { message: 'Blocked URL' });
  });
  it('blocks IPv6 loopback ::1', async () => {
    await assert.rejects(() => validateUrl('http://[::1]/'), { message: 'Blocked URL' });
  });
  it('blocks IPv6 ULA fd00::', async () => {
    await assert.rejects(() => validateUrl('http://[fd00::1]/'), { message: 'Blocked URL' });
  });
  it('blocks IPv4-mapped IPv6 to RFC1918', async () => {
    await assert.rejects(() => validateUrl('http://[::ffff:10.0.0.1]/'), { message: 'Blocked URL' });
  });
  it('still allows public IPs', async () => {
    assert.equal(await validateUrl('http://8.8.8.8/'), 'http://8.8.8.8/');
  });
});

describe('classifyIp', () => {
  it('classifies IPv4 ranges', () => {
    assert.equal(classifyIp('127.0.0.1'),    'loopback');
    assert.equal(classifyIp('127.255.255.254'), 'loopback');
    assert.equal(classifyIp('10.0.0.1'),     'private');
    assert.equal(classifyIp('172.16.0.1'),   'private');
    assert.equal(classifyIp('172.31.0.1'),   'private');
    assert.equal(classifyIp('172.32.0.1'),   'public');
    assert.equal(classifyIp('192.168.1.1'),  'private');
    assert.equal(classifyIp('100.64.0.1'),   'cgnat');
    assert.equal(classifyIp('169.254.1.1'),  'link-local');
    assert.equal(classifyIp('0.0.0.0'),      'unspecified');
    assert.equal(classifyIp('224.0.0.1'),    'reserved');
    assert.equal(classifyIp('255.255.255.255'), 'reserved');
    assert.equal(classifyIp('8.8.8.8'),      'public');
  });

  it('classifies IPv6 ranges', () => {
    assert.equal(classifyIp('::1'),         'loopback');
    assert.equal(classifyIp('::'),          'unspecified');
    assert.equal(classifyIp('fe80::1'),     'link-local');
    assert.equal(classifyIp('fd00::1'),     'private');
    assert.equal(classifyIp('fc00::1'),     'private');
    assert.equal(classifyIp('ff02::1'),     'reserved');
    assert.equal(classifyIp('2001:db8::1'), 'public');
  });

  it('unwraps IPv4-mapped IPv6', () => {
    assert.equal(classifyIp('::ffff:10.0.0.1'),         'private');
    assert.equal(classifyIp('::ffff:169.254.169.254'),  'link-local');
    assert.equal(classifyIp('::ffff:8.8.8.8'),          'public');
  });

  it('returns invalid for non-IPs', () => {
    assert.equal(classifyIp('not-an-ip'), 'invalid');
    assert.equal(classifyIp(''),          'invalid');
    assert.equal(classifyIp(null),        'invalid');
  });
});
