const envInt = (key, fallback) => {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const envEnum = (key, allowed, fallback) => {
  const v = process.env[key];
  return allowed.includes(v) ? v : fallback;
};

export const CONFIG = {
  // Timeouts
  NAV_TIMEOUT:      envInt('CONTRASTCAP_NAV_TIMEOUT', 30_000),
  ELEMENT_TIMEOUT:  envInt('CONTRASTCAP_ELEMENT_TIMEOUT', 5_000),
  AUDIT_TIMEOUT:    envInt('CONTRASTCAP_AUDIT_TIMEOUT', 120_000),

  // Audit behavior
  DEFAULT_LEVEL:    envEnum('CONTRASTCAP_LEVEL', ['AA', 'AAA'], 'AA'),
  MAX_ELEMENTS:     envInt('CONTRASTCAP_MAX_ELEMENTS', 200),
  MAX_CONCURRENT:   envInt('CONTRASTCAP_MAX_CONCURRENT', 2),

  // Viewport
  VIEWPORT_WIDTH:   envInt('CONTRASTCAP_VIEWPORT_WIDTH', 1280),
  VIEWPORT_HEIGHT:  envInt('CONTRASTCAP_VIEWPORT_HEIGHT', 800),

  // Input caps
  MAX_URL_LENGTH:   2048,
  SELECTOR_MAX_LEN: 1024,

  // Warning heuristics
  MARGINAL_DELTA:   0.3,   // ratio within this of threshold → warning, not fail
  VARIANCE_STDDEV:  15,    // per-channel stddev above this → high variance

  USER_AGENT: 'contrastcap-mcp/0.1 (WCAG contrast auditor)',

  // SSRF denylist — mirrors lightcap.
  BLOCKED_HOSTNAMES: [
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.azure.com',
    '0.0.0.0',
  ],
  BLOCKED_IP_PREFIXES: [
    '169.254.',                // IPv4 link-local (AWS IMDS)
    'fd00:',                   // IPv6 unique-local
    'fe80:',                   // IPv6 link-local
    '::',                      // IPv6 unspecified/loopback-equivalent
  ],
  LOCALHOST_HOSTS: [
    'localhost', '127.0.0.1', '::1', '[::1]',
  ],
};

// ─── Logging ──────────────────────────────────────────────────────
// Verbosity: 'quiet' = errors only, 'normal' = error+info, 'verbose' = +debug

let verbosity = 'normal';

export function setVerbosity(level) {
  if (['quiet', 'normal', 'verbose'].includes(level)) verbosity = level;
}

export function log(level, msg) {
  if (verbosity === 'quiet' && level !== 'error') return;
  if (verbosity === 'normal' && level === 'debug') return;
  console.error(`[contrastcap] ${msg}`);
}
