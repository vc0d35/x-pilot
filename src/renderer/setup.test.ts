import { describe, it, expect } from 'vitest';
import { classifyAgentFailure, setupIssue } from './setup';

/** Copied from src/main/agent/codex/binary.ts; the renderer must not import main. */
const CODEX_MISSING_MESSAGE =
  'Codex CLI not found. Install it with `npm i -g @openai/codex`, run `codex login`, or set the binary path in Settings.';

describe('classifyAgentFailure', () => {
  it('reads the messages main produces for a missing or unrunnable binary', () => {
    expect(classifyAgentFailure(CODEX_MISSING_MESSAGE)).toBe('missing');
    expect(classifyAgentFailure('Could not start codex: spawn codex ENOENT. Install Codex CLI and run `codex login`.')).toBe('missing');
    expect(classifyAgentFailure('Could not start codex: spawn /opt/codex EACCES. Install Codex CLI and run `codex login`.')).toBe(
      'missing',
    );
  });

  it('reads the auth failures Codex reports on the first turn', () => {
    expect(classifyAgentFailure('You are not logged in. Run `codex login`.')).toBe('logged-out');
    expect(classifyAgentFailure('no Codex credentials were found')).toBe('logged-out');
    expect(classifyAgentFailure('Your access token could not be refreshed. Please log out and sign in again.')).toBe('logged-out');
    expect(classifyAgentFailure('stream error: unexpected status 401 Unauthorized')).toBe('logged-out');
    expect(classifyAgentFailure('{"code":"unauthorized","message":"missing bearer"}')).toBe('logged-out');
    expect(classifyAgentFailure('ChatGPT account ID not available, please re-run `codex login`')).toBe('logged-out');
  });

  it('leaves anything else as other, including an empty message', () => {
    expect(classifyAgentFailure('codex exited (1): thread pool panicked')).toBe('other');
    expect(classifyAgentFailure('turn failed: usage_limit_exceeded')).toBe('other');
    expect(classifyAgentFailure('')).toBe('other');
    expect(classifyAgentFailure(undefined)).toBe('other');
  });
});

describe('setupIssue', () => {
  const base = { status: 'ready' as const, failure: null as { message: string } | null, everSucceeded: false };

  it('is null with no failure', () => {
    expect(setupIssue(base)).toBeNull();
  });

  it('shows a missing or logged-out problem even while the status reads ready', () => {
    expect(setupIssue({ ...base, failure: { message: CODEX_MISSING_MESSAGE } })).toEqual({
      problem: 'missing',
      message: CODEX_MISSING_MESSAGE,
    });
    expect(setupIssue({ ...base, failure: { message: 'not logged in' } })?.problem).toBe('logged-out');
    expect(setupIssue({ ...base, status: 'running', everSucceeded: true, failure: { message: 'not logged in' } })?.problem).toBe(
      'logged-out',
    );
  });

  it('shows an unclassified failure only while the agent is down and nothing has worked yet', () => {
    const failure = { message: 'codex exited (1): panicked at core/src/lib.rs' };
    expect(setupIssue({ ...base, status: 'error', failure })).toEqual({ problem: 'other', message: failure.message });
    expect(setupIssue({ ...base, status: 'disconnected', failure })?.problem).toBe('other');
    expect(setupIssue({ ...base, status: 'error', everSucceeded: true, failure })).toBeNull();
    expect(setupIssue({ ...base, status: 'ready', failure })).toBeNull();
  });
});
