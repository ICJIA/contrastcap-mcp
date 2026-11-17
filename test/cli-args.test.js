import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractVerbosity, isServerInvocation } from '../src/cli-args.js';

describe('extractVerbosity', () => {
  it('pulls --verbose out from before a subcommand', () => {
    const { verbosity, rest } = extractVerbosity(['--verbose', 'summary', 'https://x.com']);
    assert.equal(verbosity, 'verbose');
    assert.deepEqual(rest, ['summary', 'https://x.com']);
  });

  it('pulls --quiet out from after a subcommand', () => {
    const { verbosity, rest } = extractVerbosity(['page', '--quiet', 'https://x.com']);
    assert.equal(verbosity, 'quiet');
    assert.deepEqual(rest, ['page', 'https://x.com']);
  });

  it('leaves args untouched when no global flag is present', () => {
    const { verbosity, rest } = extractVerbosity(['summary', 'https://x.com']);
    assert.equal(verbosity, null);
    assert.deepEqual(rest, ['summary', 'https://x.com']);
  });
});

describe('isServerInvocation', () => {
  it('starts the server for a bare invocation with piped stdin (MCP clients)', () => {
    assert.equal(isServerInvocation([], false), true);
  });

  it('starts the server for `lightcap --verbose` / `--quiet` from an MCP config', () => {
    assert.equal(isServerInvocation(extractVerbosity(['--verbose']).rest, false), true);
    assert.equal(isServerInvocation(extractVerbosity(['--quiet']).rest, false), true);
  });

  it('does NOT start the server for a bare invocation at a TTY (shows help instead)', () => {
    assert.equal(isServerInvocation([], true), false);
  });

  it('runs the subcommand when a global flag precedes it (regression)', () => {
    assert.equal(isServerInvocation(extractVerbosity(['--verbose', 'summary', 'https://x.com']).rest, false), false);
  });

  it('never starts the server when a subcommand is present', () => {
    assert.equal(isServerInvocation(['summary', 'https://x.com'], false), false);
    assert.equal(isServerInvocation(['page', 'https://x.com'], true), false);
    assert.equal(isServerInvocation(['status'], false), false);
  });

  it('hands --help / --version to commander, not the server', () => {
    for (const f of ['--help', '-h', '--version', '-V']) {
      assert.equal(isServerInvocation([f], false), false);
    }
  });

  it('keeps pre-0.3.0 behavior: an unknown leading flag starts the server', () => {
    assert.equal(isServerInvocation(['--some-server-arg'], false), true);
  });
});
