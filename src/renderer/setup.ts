import type { AgentStatus } from '../shared/agent';

export type SetupProblem = 'missing' | 'logged-out' | 'other';

export interface SetupIssue {
  problem: SetupProblem;
  /** The agent's own words, shown verbatim for `other` (it already carries the stderr tail). */
  message: string;
}

/**
 * Both shapes main produces when the binary cannot be run: `CODEX_MISSING_MESSAGE` from
 * `resolveBinary`, and `Could not start codex: spawn … ENOENT/EACCES` from `proc.on('error')`.
 */
const MISSING = /codex cli not found|could not start codex|\bENOENT\b|\bEACCES\b/i;

/**
 * Codex reports auth on the first turn, not at spawn, and the wording varies by credential
 * source: "not logged in", "no Codex credentials were found", "Please sign in again",
 * "please re-run `codex login`", plus bare HTTP 401 / `unauthorized` error codes.
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
  /(?:re-?run|run|running) `?codex login/i,
];

export function classifyAgentFailure(message: string | null | undefined): SetupProblem {
  const text = (message ?? '').trim();
  if (MISSING.test(text)) return 'missing';
  if (LOGGED_OUT.some((re) => re.test(text))) return 'logged-out';
  return 'other';
}

/**
 * The setup card is for problems the user can fix. A message that names a missing binary or a
 * missing login always earns one; anything else only while the agent is unusable and nothing has
 * worked yet this session, so a one-off failed turn mid-conversation stays a transcript line.
 */
export function setupIssue(state: { status: AgentStatus; failure: { message: string } | null; everSucceeded: boolean }): SetupIssue | null {
  if (!state.failure) return null;
  const problem = classifyAgentFailure(state.failure.message);
  if (problem !== 'other') return { problem, message: state.failure.message };
  const stuck = state.status === 'error' || state.status === 'disconnected';
  return stuck && !state.everSucceeded ? { problem, message: state.failure.message } : null;
}
