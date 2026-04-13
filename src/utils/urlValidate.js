import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { CONFIG } from '../config.js';

// Classify an IP address into a network category. Returns one of:
//   'loopback'   – 127.0.0.0/8, ::1
//   'private'    – RFC1918 (10/8, 172.16/12, 192.168/16), IPv6 ULA (fc00::/7)
//   'cgnat'      – 100.64.0.0/10
//   'link-local' – 169.254.0.0/16 (incl. cloud metadata), fe80::/10
//   'unspecified'– 0.0.0.0, ::
//   'reserved'   – multicast / class E / other non-routable
//   'public'     – everything else
//   'invalid'    – not parseable
function classifyIp(address) {
  if (typeof address !== 'string') return 'invalid';
  // Unwrap IPv4-mapped IPv6 (e.g. ::ffff:10.0.0.1) so v4 rules apply.
  const ip = /^::ffff:/i.test(address) ? address.slice(7) : address;
  const v = isIP(ip);

  if (v === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
      return 'invalid';
    }
    const [a, b] = parts;
    if (a === 0) return 'unspecified';
    if (a === 127) return 'loopback';
    if (a === 169 && b === 254) return 'link-local';
    if (a === 10) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
    if (a >= 224) return 'reserved'; // multicast (224-239), class E (240+), broadcast (255)
    return 'public';
  }

  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::') return 'unspecified';
    if (lower === '::1') return 'loopback';
    if (/^fe[89ab][0-9a-f]?:/.test(lower)) return 'link-local';
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return 'private'; // fc00::/7 ULA
    if (lower.startsWith('ff')) return 'reserved';          // multicast
    return 'public';
  }

  return 'invalid';
}

function isAllowedClass(category) {
  switch (category) {
    case 'public':
      return true;
    case 'loopback':
    case 'private':
    case 'cgnat':
      return !CONFIG.BLOCK_PRIVATE_IPS;
    // 'link-local' (cloud metadata), 'unspecified', 'reserved', 'invalid' → always blocked
    default:
      return false;
  }
}

async function isBlockedHost(hostname) {
  if (!hostname) return true;
  // If the hostname is already a literal IP, classify directly without DNS.
  if (isIP(hostname)) return !isAllowedClass(classifyIp(hostname));
  // Strip surrounding brackets from IPv6 literals (URL hostnames keep them).
  const stripped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (isIP(stripped)) return !isAllowedClass(classifyIp(stripped));

  try {
    const { address } = await lookup(hostname);
    return !isAllowedClass(classifyIp(address));
  } catch {
    return true; // DNS failure → fail closed
  }
}

export async function validateUrl(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > CONFIG.MAX_URL_LENGTH) {
    throw new Error('Invalid URL');
  }

  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Invalid URL'); }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Blocked URL scheme');
  }
  if (CONFIG.BLOCKED_HOSTNAMES.includes(parsed.hostname)) {
    throw new Error('Blocked URL');
  }
  if (await isBlockedHost(parsed.hostname)) {
    throw new Error('Blocked URL');
  }
  return parsed.href;
}

export const _test = { isBlockedHost, classifyIp };
