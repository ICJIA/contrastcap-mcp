#!/usr/bin/env node

import { program } from 'commander';
import { readFileSync } from 'fs';
import { execFile } from 'child_process';
import { createRequire } from 'module';
import { setVerbosity, CONFIG } from './config.js';
import { closeBrowser } from './browser.js';
import { checkPageContrast } from './tools/checkPageContrast.js';
import { checkElementContrast } from './tools/checkElementContrast.js';
import { getContrastSummary } from './tools/getContrastSummary.js';
import { sanitizeError } from './utils/sanitizeError.js';
import { extractVerbosity, isServerInvocation } from './cli-args.js';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

function readPkgVersion(specifier) {
  try {
    return JSON.parse(readFileSync(require.resolve(`${specifier}/package.json`), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

const axeVersion = readPkgVersion('axe-core');

program
  .name('contrastcap')
  .description('WCAG contrast auditor — pixel-level resolution of axe-core "needs review" items')
  .version(`contrastcap v${pkg.version} (axe-core v${axeVersion})`, '-V, --version', 'Show contrastcap and axe-core versions')
  .addHelpText('before', `contrastcap v${pkg.version} — axe-core v${axeVersion}\n`)
  .addHelpText('after', `
Examples:
  contrastcap summary https://example.com              pass/fail/warning counts (cheapest)
  contrastcap page http://localhost:3000               failures + warnings with hex fixes
  contrastcap page http://localhost:3000 --level AAA   WCAG AAA (7:1 / 4.5:1)
  contrastcap element http://localhost:3000 'nav a'    one element, after a fix
  contrastcap status                                   versions + update check

Output is JSON, identical to the MCP tools. Exit code 1 on any error.

Global flags (any position):
  --quiet     errors only on stderr (keeps output to the report itself)
  --verbose   log browser lifecycle and sampling details

Run 'contrastcap <command> --help' for a command's options.
With no arguments and piped stdin (as MCP clients launch it), contrastcap runs as an MCP server.`);

// --verbose / --quiet are handled before commander (see dispatch at the
// bottom), so their position relative to a subcommand does not matter.

function validLevel(v) {
  return v === 'AAA' ? 'AAA' : 'AA';
}

async function runAndPrint(fn) {
  try {
    const result = await fn();
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`Error: ${sanitizeError(err)}`);
    process.exitCode = 1;
  } finally {
    await closeBrowser();
  }
}

program
  .command('summary <url>')
  .description('Summary counts only (lowest token cost)')
  .option('-l, --level <AA|AAA>', 'WCAG level', 'AA')
  .action(async (url, opts) => {
    await runAndPrint(() => getContrastSummary({ url, level: validLevel(opts.level) }));
  });

program
  .command('page <url>')
  .description('Full page audit — failures and warnings with detail')
  .option('-l, --level <AA|AAA>', 'WCAG level', 'AA')
  .action(async (url, opts) => {
    await runAndPrint(() => checkPageContrast({ url, level: validLevel(opts.level) }));
  });

program
  .command('element <url> <selector>')
  .description('Check a single element by CSS selector')
  .option('-l, --level <AA|AAA>', 'WCAG level', 'AA')
  .action(async (url, selector, opts) => {
    await runAndPrint(() => checkElementContrast({ url, selector, level: validLevel(opts.level) }));
  });

program
  .command('status')
  .description('Show version info')
  .action(async () => {
    const playwrightVersion = readPkgVersion('playwright');

    let latest = 'unknown';
    try {
      latest = await new Promise((resolve, reject) => {
        execFile('npm', ['view', '@icjia/contrastcap', 'version'], { timeout: 5000 }, (err, stdout) => {
          if (err) reject(err);
          else {
            const raw = stdout.trim();
            resolve(/^\d+\.\d+\.\d+/.test(raw) ? raw : 'unknown');
          }
        });
      });
    } catch { /* ignore */ }

    const updateNote = (latest === 'unknown' || latest === pkg.version)
      ? '(latest)'
      : `(latest: v${latest} — update available)`;

    console.log('contrastcap status');
    console.log(`  Server:     @icjia/contrastcap v${pkg.version} ${updateNote}`);
    console.log(`  axe-core:   v${axeVersion}`);
    console.log(`  playwright: v${playwrightVersion}`);
    console.log(`  Node:       v${process.versions.node}`);
    console.log(`  Platform:   ${process.platform} ${process.arch}`);
    console.log(`  Default:    WCAG ${CONFIG.DEFAULT_LEVEL}`);
  });

// Handle global flags first (position-independent), then dispatch: a bare
// invocation with piped stdin (how MCP clients launch us) starts the MCP
// server; a bare invocation at an interactive terminal prints help instead of
// silently waiting for JSON-RPC; anything else goes to commander.
const { verbosity, rest } = extractVerbosity(process.argv.slice(2));
if (verbosity) setVerbosity(verbosity);

if (isServerInvocation(rest, Boolean(process.stdin.isTTY))) {
  await import('./server.js');
} else if (rest.length === 0) {
  // Bare `contrastcap` typed at a terminal: show help on stdout and exit 0.
  program.help();
} else {
  program.parse(rest, { from: 'user' });
}
