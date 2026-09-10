import {
  VIEW_CONSOLE_BYTES_MAX,
  VIEW_CONSOLE_TEXT_MAX,
  VIEW_FATAL_ERRORS_PER_WINDOW,
  VIEW_FATAL_ERROR_WINDOW_MS,
  VIEW_RELOAD_FAILURES_MAX,
  VIEW_RUNTIME_ERRORS_PER_WINDOW,
  VIEW_RUNTIME_ERROR_WINDOW_MS,
  VIEW_RUNTIME_REPORT_MS,
  type ViewErrorReport,
  type ViewLogEntry,
} from '../../shared/views';

/** What one runtime error should cause: a banner, the end of the view, or nothing at all. */
export interface RuntimeDecision {
  /** Raise the banner: the first error of an activation, then at most one every 30 s. */
  report: boolean;
  /** A storm: the view has erred more than it can be watched through, so it comes off the screen. */
  storm: boolean;
}

interface ViewCounters {
  runtime: number[];
  fatal: number[];
  reportedAt: number | null;
  reloadFailures: number;
}

const within = (times: number[], now: number, windowMs: number): number[] => times.filter((t) => now - t < windowMs);

/**
 * How much a view has gone wrong lately, per view. A view is agent-written code that renders over
 * x.com with no turn around it: one error is worth a banner, a storm of them is worth the screen
 * back. The counters are the whole policy, kept here so they can be reasoned about without a
 * renderer — the canvas only decides what to do with the answers.
 */
export class ViewErrorCounters {
  private readonly byView = new Map<string, ViewCounters>();

  constructor(private readonly now: () => number = Date.now) {}

  private of(view: string): ViewCounters {
    const counters = this.byView.get(view) ?? { runtime: [], fatal: [], reportedAt: null, reloadFailures: 0 };
    this.byView.set(view, counters);
    return counters;
  }

  /**
   * A view went on screen. Its runtime errors start again from nothing — the agent may well have
   * just fixed them — but its crashes deliberately do not: two of those inside five minutes is a
   * view that cannot be retried into, however many times it is activated in between.
   */
  activated(view: string): void {
    const counters = this.of(view);
    counters.runtime = [];
    counters.reportedAt = null;
    counters.reloadFailures = 0;
  }

  /** One error the view's own scripts threw. */
  runtime(view: string): RuntimeDecision {
    const now = this.now();
    const counters = this.of(view);
    counters.runtime = [...within(counters.runtime, now, VIEW_RUNTIME_ERROR_WINDOW_MS), now];
    if (counters.runtime.length > VIEW_RUNTIME_ERRORS_PER_WINDOW) return { report: false, storm: true };
    const report = counters.reportedAt === null || now - counters.reportedAt >= VIEW_RUNTIME_REPORT_MS;
    if (report) counters.reportedAt = now;
    return { report, storm: false };
  }

  /** A crash, a wedge or a load that failed. True when this one is one too many to retry into. */
  fatal(view: string): boolean {
    const now = this.now();
    const counters = this.of(view);
    counters.fatal = [...within(counters.fatal, now, VIEW_FATAL_ERROR_WINDOW_MS), now];
    return counters.fatal.length >= VIEW_FATAL_ERRORS_PER_WINDOW;
  }

  /** A load finished, so whatever the last reload did wrong is behind us. */
  loaded(view: string): void {
    this.of(view).reloadFailures = 0;
  }

  /**
   * Whether a change on disk should reload the view. Two reloads that failed to load in a row stop
   * the third: a view that cannot load is not worth reloading at the speed a watcher can fire. The
   * count is cleared as it refuses, so the next file change is a fresh attempt.
   */
  shouldReload(view: string): boolean {
    const counters = this.of(view);
    if (counters.reloadFailures < VIEW_RELOAD_FAILURES_MAX) return true;
    counters.reloadFailures = 0;
    return false;
  }

  reloadFailed(view: string): void {
    this.of(view).reloadFailures += 1;
  }

  forget(view: string): void {
    this.byView.delete(view);
  }
}

/** `file:line:col`, as much of it as the view said, or undefined when it said nothing useful. */
export function formatWhere(report: Pick<ViewErrorReport, 'source' | 'line' | 'column'>): string | undefined {
  if (!report.source) return undefined;
  if (report.line === undefined) return report.source;
  return report.column === undefined ? `${report.source}:${report.line}` : `${report.source}:${report.line}:${report.column}`;
}

export interface BoundedConsole {
  entries: ViewLogEntry[];
  /** True when lines were dropped or shortened to stay inside the caps. */
  truncated: boolean;
}

/**
 * What xpilot_view_console hands the model. A view can log in a render loop, so the tool is bounded
 * twice over: every line is cut, and the newest lines are taken until the whole answer would be
 * bigger than a tool result should be. The newest are what a failure is debugged from.
 */
export function boundConsoleEntries(entries: readonly ViewLogEntry[], bytesMax: number = VIEW_CONSOLE_BYTES_MAX): BoundedConsole {
  const kept: ViewLogEntry[] = [];
  // The two brackets of the array the entries are handed back in; each entry costs its comma below.
  let bytes = 2;
  let truncated = false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const text = entry.text.length > VIEW_CONSOLE_TEXT_MAX ? `${entry.text.slice(0, VIEW_CONSOLE_TEXT_MAX)}…` : entry.text;
    if (text !== entry.text) truncated = true;
    const cut: ViewLogEntry = { ...entry, text };
    const size = Buffer.byteLength(JSON.stringify(cut)) + 1;
    if (bytes + size > bytesMax) {
      truncated = true;
      break;
    }
    bytes += size;
    kept.push(cut);
  }
  kept.reverse();
  if (kept.length < entries.length) truncated = true;
  return { entries: kept, truncated };
}
