#!/usr/bin/env node

import { readFileSync } from 'fs';
import { execFile } from 'child_process';
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { CONFIG, log, setVerbosity } from './config.js';
import { closeBrowser } from './browser.js';
import { sanitizeError } from './utils/sanitizeError.js';
import { checkPageContrast } from './tools/checkPageContrast.js';
import { checkElementContrast } from './tools/checkElementContrast.js';
import { getContrastSummary } from './tools/getContrastSummary.js';

if (process.argv.includes('--verbose')) setVerbosity('verbose');
if (process.argv.includes('--quiet')) setVerbosity('quiet');

// ─── Version info ──────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const serverVersion = pkg.version;

let axeVersion = 'unknown';
let playwrightVersion = 'unknown';
try {
  axeVersion = JSON.parse(readFileSync(new URL('../node_modules/axe-core/package.json', import.meta.url))).version;
} catch { /* ignore */ }
try {
  playwrightVersion = JSON.parse(readFileSync(new URL('../node_modules/playwright/package.json', import.meta.url))).version;
} catch { /* ignore */ }

let _latestVersion = null;
const _latestPromise = new Promise((resolve) => {
  execFile('npm', ['view', '@icjia/contrastcap', 'version'], { timeout: 5000 }, (err, stdout) => {
    const raw = err ? 'unknown' : stdout.trim();
    _latestVersion = /^\d+\.\d+\.\d+/.test(raw) ? raw : 'unknown';
    resolve(_latestVersion);
  });
});

async function getLatestVersion() {
  if (_latestVersion) return _latestVersion;
  return _latestPromise;
}

log('info', `Server v${serverVersion} | axe-core v${axeVersion} | playwright v${playwrightVersion}`);

// ─── Concurrency queue ─────────────────────────────────────────────

let inFlight = 0;

async function runQueued(fn) {
  if (inFlight >= CONFIG.MAX_CONCURRENT) {
    throw new Error('Audit queue full — try again shortly');
  }
  inFlight++;
  try { return await fn(); }
  finally { inFlight--; }
}

// ─── MCP Server ────────────────────────────────────────────────────

const server = new McpServer({
  name: 'contrastcap',
  version: serverVersion,
});

function asJsonText(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

function asErrorText(err) {
  return { content: [{ type: 'text', text: `Error: ${sanitizeError(err)}` }] };
}

// ─── get_contrast_summary ──────────────────────────────────────────

server.registerTool(
  'get_contrast_summary',
  {
    description: 'Run a contrast audit against a URL and return only summary counts (pass / fail / warning / skipped). Minimal token cost — use this first before requesting full detail. Defaults to WCAG AA.',
    inputSchema: z.object({
      url:   z.string().max(CONFIG.MAX_URL_LENGTH).describe('HTTP or HTTPS URL to audit (localhost, staging, or prod)'),
      level: z.enum(['AA', 'AAA']).default('AA').describe('WCAG conformance level. Defaults to AA. AAA must be explicitly requested.'),
    }),
  },
  async (params) => {
    try {
      const result = await runQueued(() => getContrastSummary(params));
      return asJsonText(result);
    } catch (err) {
      log('error', err.message);
      return asErrorText(err);
    }
  }
);

// ─── check_page_contrast ───────────────────────────────────────────

server.registerTool(
  'check_page_contrast',
  {
    description: 'Run a full contrast audit against a URL. Returns detailed entries for failures and warnings (passes are counted but not itemized). Resolves axe-core "needs review" items via pixel sampling. Includes hex suggestions for failing foregrounds. Defaults to WCAG AA.',
    inputSchema: z.object({
      url:            z.string().max(CONFIG.MAX_URL_LENGTH).describe('HTTP or HTTPS URL to audit (localhost, staging, or prod)'),
      level:          z.enum(['AA', 'AAA']).default('AA').describe('WCAG conformance level. Defaults to AA. AAA must be explicitly requested.'),
      include_passes: z.boolean().default(false).describe('Reserved for future use — currently passing elements are always counted, never itemized, to keep token usage low.'),
    }),
  },
  async (params) => {
    try {
      const result = await runQueued(() => checkPageContrast(params));
      return asJsonText(result);
    } catch (err) {
      log('error', err.message);
      return asErrorText(err);
    }
  }
);

// ─── check_element_contrast ────────────────────────────────────────

server.registerTool(
  'check_element_contrast',
  {
    description: 'Check contrast for a single element on a page, identified by CSS selector. Returns the computed ratio and a hex suggestion if failing. Useful for verifying a fix without re-running the whole page audit. Defaults to WCAG AA.',
    inputSchema: z.object({
      url:      z.string().max(CONFIG.MAX_URL_LENGTH).describe('HTTP or HTTPS URL to load'),
      selector: z.string().max(CONFIG.SELECTOR_MAX_LEN).describe('CSS selector for the target element'),
      level:    z.enum(['AA', 'AAA']).default('AA').describe('WCAG conformance level. Defaults to AA.'),
    }),
  },
  async (params) => {
    try {
      const result = await runQueued(() => checkElementContrast(params));
      return asJsonText(result);
    } catch (err) {
      log('error', err.message);
      return asErrorText(err);
    }
  }
);

// ─── get_status ────────────────────────────────────────────────────

server.registerTool(
  'get_status',
  {
    description: 'Return contrastcap server version, installed axe-core and playwright versions, and whether a newer contrastcap is available on npm.',
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const latest = await getLatestVersion();
      const updateNote = (latest === 'unknown' || latest === serverVersion)
        ? '(latest)'
        : `(latest: v${latest} — update available)`;

      const text = [
        'contrastcap status',
        `  Server:     @icjia/contrastcap v${serverVersion} ${updateNote}`,
        `  axe-core:   v${axeVersion}`,
        `  playwright: v${playwrightVersion}`,
        `  Node:       v${process.versions.node}`,
        `  Platform:   ${process.platform} ${process.arch}`,
        `  Default:    WCAG ${CONFIG.DEFAULT_LEVEL}`,
      ].join('\n');

      return { content: [{ type: 'text', text }] };
    } catch (err) {
      log('error', err.message);
      return asErrorText(err);
    }
  }
);

// ─── Shutdown ──────────────────────────────────────────────────────

async function shutdown() {
  await closeBrowser();
  process.exit(0);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

// ─── Start ─────────────────────────────────────────────────────────

console.error('[contrastcap] Server started — tools: get_contrast_summary, check_page_contrast, check_element_contrast, get_status');
const transport = new StdioServerTransport();
await server.connect(transport);
