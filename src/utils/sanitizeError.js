import { log } from '../config.js';

const KNOWN = [
  'Blocked URL scheme',
  'Blocked URL',
  'Invalid URL',
  'Element not found',
  'Element has zero size',
  'Audit timed out',
  'Audit queue full',
  'Page navigation timed out',
];

export function sanitizeError(err) {
  const msg = err?.message || 'Unknown error';

  if (KNOWN.some(k => msg.startsWith(k))) return msg;

  if (msg.includes('ECONNREFUSED') || msg.includes('ERR_CONNECTION_REFUSED')) {
    return 'Could not connect to URL';
  }
  if (msg.includes('ETIMEDOUT') || msg.includes('ETIMEOUT') || msg.includes('ERR_TIMED_OUT')) {
    return 'Connection timed out';
  }
  if (msg.includes('ERR_NAME_NOT_RESOLVED') || msg.includes('ENOTFOUND')) {
    return 'Could not resolve hostname';
  }
  if (msg.includes('net::ERR_')) {
    return 'Network error';
  }
  if (msg.toLowerCase().startsWith('invalid url')) {
    return 'Invalid URL';
  }

  log('error', `Unhandled error: ${msg}`);
  return 'Audit failed';
}
