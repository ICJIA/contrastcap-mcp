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

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

function readPkgVersion(specifier) {
  try {
    return JSON.parse(readFileSync(require.resolve(`${specifier}/package.json`), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

program
  .name('contrastcap')
  .description('WCAG contrast auditor — pixel-level resolution of axe-core "needs review" items')
  .version(pkg.version);

program
  .option('--verbose', 'Verbose logging')
  .option('--quiet', 'Errors only');

function applyGlobalOptions() {
  const opts = program.opts();
  if (opts.verbose) setVerbosity('verbose');
  if (opts.quiet) setVerbosity('quiet');
}

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
    applyGlobalOptions();
    await runAndPrint(() => getContrastSummary({ url, level: validLevel(opts.level) }));
  });

program
  .command('page <url>')
  .description('Full page audit — failures and warnings with detail')
  .option('-l, --level <AA|AAA>', 'WCAG level', 'AA')
  .action(async (url, opts) => {
    applyGlobalOptions();
    await runAndPrint(() => checkPageContrast({ url, level: validLevel(opts.level) }));
  });

program
  .command('element <url> <selector>')
  .description('Check a single element by CSS selector')
  .option('-l, --level <AA|AAA>', 'WCAG level', 'AA')
  .action(async (url, selector, opts) => {
    applyGlobalOptions();
    await runAndPrint(() => checkElementContrast({ url, selector, level: validLevel(opts.level) }));
  });

program
  .command('status')
  .description('Show version info')
  .action(async () => {
    const axeVersion = readPkgVersion('axe-core');
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

// Default: start the MCP server when invoked with no subcommand (the npx entry)
const subcommands = ['summary', 'page', 'element', 'status', 'help'];
const arg2 = process.argv[2];
const isSubcommand = arg2 && (
  subcommands.includes(arg2) ||
  arg2 === '--help' || arg2 === '-h' ||
  arg2 === '--version' || arg2 === '-V'
);

if (!arg2 || (!isSubcommand && arg2.startsWith('-'))) {
  await import('./server.js');
} else {
  program.parse();
}
