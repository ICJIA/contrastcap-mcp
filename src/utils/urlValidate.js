import { lookup } from 'dns/promises';
import { CONFIG } from '../config.js';

async function isBlockedIp(hostname) {
  if (CONFIG.LOCALHOST_HOSTS.includes(hostname)) return false;
  try {
    const { address } = await lookup(hostname);
    const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
    return CONFIG.BLOCKED_IP_PREFIXES.some(p => normalized.startsWith(p));
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
  if (await isBlockedIp(parsed.hostname)) {
    throw new Error('Blocked URL');
  }
  return parsed.href;
}

export const _test = { isBlockedIp };
