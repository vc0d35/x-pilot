import { describe, it, expect } from 'vitest';
import { classifyAgentFailure, providerFix, providerFixHint, setupIssue } from './setup';
import { NO_PROVIDER_MESSAGE } from './provider-ui';

/** Copied from src/main/agent/{codex,claude}/binary.ts; the renderer must not import main. */
const CODEX_MISSING_MESSAGE =
  'Codex CLI not found. Install it with `npm i -g @openai/codex`, run `codex login`, or set the binary path in Settings.';
const CLAUDE_MISSING_MESSAGE =
  'Claude Code not found. Install it from claude.com/code, run `claude` once to log in, or set the binary path in Settings.';

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

  it('reads the messages main produces when Claude Code cannot be run', () => {
    expect(classifyAgentFailure(CLAUDE_MISSING_MESSAGE)).toBe('missing');
    expect(classifyAgentFailure('Could not start claude: spawn claude ENOENT')).toBe('missing');
  });

  it('reads the auth failures Claude Code reports', () => {
    expect(classifyAgentFailure('Not logged in')).toBe('logged-out');
    expect(classifyAgentFailure('Invalid API key · Please run /login')).toBe('logged-out');
    expect(classifyAgentFailure('OAuth token has expired')).toBe('logged-out');
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

  it('leaves the first-run picker to say that no backend is chosen', () => {
    expect(setupIssue({ ...base, status: 'disconnected', failure: { message: NO_PROVIDER_MESSAGE } })).toBeNull();
  });

  it('shows an unclassified failure only while the agent is down and nothing has worked yet', () => {
    const failure = { message: 'codex exited (1): panicked at core/src/lib.rs' };
    expect(setupIssue({ ...base, status: 'error', failure })).toEqual({ problem: 'other', message: failure.message });
    expect(setupIssue({ ...base, status: 'disconnected', failure })?.problem).toBe('other');
    expect(setupIssue({ ...base, status: 'error', everSucceeded: true, failure })).toBeNull();
    expect(setupIssue({ ...base, status: 'ready', failure })).toBeNull();
  });
});

describe('providerFix', () => {
  it("phrases the fix in each backend's own terms", () => {
    expect(providerFix('codex', 'logged-out').commands).toEqual(['codex login']);
    expect(providerFix('codex', 'missing').commands).toContain('npm i -g @openai/codex');
    expect(providerFix('claude', 'logged-out').hint).toContain('`claude` once');
    expect(providerFix('claude', 'missing').headline).toContain('Claude Code');
    expect(providerFix('claude', 'missing').hint).toContain('claude.com/code');
  });

  it('turns a probe error into the one line the picker shows under it', () => {
    expect(providerFixHint('claude', 'Invalid API key · Please run /login')).toContain('log in');
    expect(providerFixHint('codex', 'You are not logged in.')).toContain('codex login');
    expect(providerFixHint('codex', CODEX_MISSING_MESSAGE)).toContain('npm i -g @openai/codex');
    expect(providerFixHint('claude', CLAUDE_MISSING_MESSAGE)).toContain('claude.com/code');
  });
});
