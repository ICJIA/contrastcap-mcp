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

  // SSRF policy.
  // Always-blocked hostnames (cloud metadata + 0.0.0.0 sentinel).
  BLOCKED_HOSTNAMES: [
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.azure.com',
    '0.0.0.0',
  ],
  // Network-class blocking is handled by CIDR classification in
  // src/utils/urlValidate.js — link-local (incl. cloud metadata),
  // unspecified, multicast, and reserved ranges are *always* blocked.
  // Private/loopback/CGNAT are allowed by default so the dev-server
  // workflow keeps working, and blocked when this flag is on.
  // Read at call time so the env flag can be flipped per-process.
  get BLOCK_PRIVATE_IPS() { return process.env.CONTRASTCAP_BLOCK_PRIVATE === '1'; },
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
