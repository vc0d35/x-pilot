import type { AgentStatus, ProviderKind } from '../shared/agent';
import { NO_PROVIDER_MESSAGE } from './provider-ui';

export type SetupProblem = 'missing' | 'logged-out' | 'other';

export interface SetupIssue {
  problem: SetupProblem;
  /** The agent's own words, shown verbatim for `other` (it already carries the stderr tail). */
  message: string;
}

/**
 * Both shapes main produces when a binary cannot be run: `CODEX_MISSING_MESSAGE` /
 * `CLAUDE_MISSING_MESSAGE` from `resolveBinary`, and `Could not start codex: spawn …
 * ENOENT/EACCES` from `proc.on('error')`.
 */
const MISSING = /codex cli not found|claude code not found|could not start (?:codex|claude)|\bENOENT\b|\bEACCES\b/i;

/**
 * Both CLIs report auth on the first turn, not at spawn, and the wording varies by credential
 * source: Codex says "not logged in", "no Codex credentials were found", "Please sign in again",
 * "please re-run `codex login`"; Claude says "Not logged in", "Invalid API key · Please run
 * /login", "OAuth token has expired"; plus bare HTTP 401 / `unauthorized` error codes.
 */
const LOGGED_OUT = [
  /not (?:logged|signed) in/i,
  /logged out/i,
  /sign in again/i,
  /unauthoriz/i,
  /\b401\b/,
  /credential/i,
  /authentication/i,
  /access token/i,
  /refresh token/i,
  /api key/i,
  /\boauth\b/i,
  /(?:re-?run|run|running) `?codex login/i,
  /(?:re-?run|run|running) `?\/login/i,
];

export function classifyAgentFailure(message: string | null | undefined): SetupProblem {
  const text = (message ?? '').trim();
  if (MISSING.test(text)) return 'missing';
  if (LOGGED_OUT.some((re) => re.test(text))) return 'logged-out';
  return 'other';
}

/** What the user is told to do about a problem, in that backend's own terms. */
export interface ProviderFix {
  headline: string;
  /** Shell commands to copy, in the order they are run. */
  commands: string[];
  hint: string;
  /** The same fix as one line, for a card that has no room to print the commands. */
  short: string;
}

const FIXES: Record<ProviderKind, Record<SetupProblem, ProviderFix>> = {
  codex: {
    missing: {
      headline: 'XPilot could not find the Codex CLI, so the agent cannot start.',
      commands: ['npm i -g @openai/codex', 'codex login'],
      hint: 'Run these in Terminal, then try again. Already installed? Codex may live outside the app’s PATH: set its full path in Settings.',
      short: 'Install the Codex CLI with `npm i -g @openai/codex`, run `codex login`, then Connect again.',
    },
    'logged-out': {
      headline: 'Codex is installed but not logged in, so it cannot answer.',
      commands: ['codex login'],
      hint: 'Run this in Terminal, sign in, then try again.',
      short: 'Run `codex login` in Terminal, then Connect again.',
    },
    other: {
      headline: 'The agent stopped and could not be started again.',
      commands: [],
      hint: 'Trying again restarts Codex and resumes this conversation.',
      short: 'Check that `codex` runs in a terminal, then Connect again.',
    },
  },
  claude: {
    missing: {
      headline: 'XPilot could not find Claude Code, so the agent cannot start.',
      commands: ['claude'],
      hint: 'Install Claude Code from claude.com/code, then run `claude` once and log in. Already installed? It may live outside the app’s PATH: set its full path in Settings.',
      short: 'Install Claude Code from claude.com/code, run `claude` once and log in, then Connect again.',
    },
    'logged-out': {
      headline: 'Claude Code is installed but not logged in, so it cannot answer.',
      commands: ['claude'],
      hint: 'Run `claude` once in Terminal and log in, then try again.',
      short: 'Run `claude` once in Terminal and log in, then Connect again.',
    },
    other: {
      headline: 'The agent stopped and could not be started again.',
      commands: [],
      hint: 'Trying again restarts Claude Code and resumes this conversation.',
      short: 'Check that `claude` runs in a terminal, then Connect again.',
    },
  },
};

export function providerFix(provider: ProviderKind, problem: SetupProblem): ProviderFix {
  return FIXES[provider][problem];
}

/** The fix as one line, for the picker, where the CLI's own error is already on screen. */
export function providerFixHint(provider: ProviderKind, message: string | null | undefined): string {
  return providerFix(provider, classifyAgentFailure(message)).short;
}

/**
 * The setup card is for problems the user can fix. A message that names a missing binary or a
 * missing login always earns one; anything else only while the agent is unusable and nothing has
 * worked yet this session, so a one-off failed turn mid-conversation stays a transcript line.
 * Having chosen no backend at all is not a setup problem: the first-run picker is that card.
 */
export function setupIssue(state: { status: AgentStatus; failure: { message: string } | null; everSucceeded: boolean }): SetupIssue | null {
  if (!state.failure || state.failure.message === NO_PROVIDER_MESSAGE) return null;
  const problem = classifyAgentFailure(state.failure.message);
  if (problem !== 'other') return { problem, message: state.failure.message };
  const stuck = state.status === 'error' || state.status === 'disconnected';
  return stuck && !state.everSucceeded ? { problem, message: state.failure.message } : null;
}
