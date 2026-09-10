import type { ViewFailure } from '../state';

/**
 * What the sidebar says when a custom view goes wrong. A view is code the agent wrote, so the two
 * things worth offering are the two the user would otherwise have to type: the X page back, and the
 * whole failure handed to the agent to repair. A fatal failure has already put X back, so its first
 * button only clears the banner; a view that is still up and merely erring keeps its own Back to X.
 */
export function ViewErrorBanner({
  failure,
  stillShowing,
  onDismiss,
  onFix,
}: {
  failure: ViewFailure;
  stillShowing: boolean;
  onDismiss: () => void;
  onFix: () => void;
}) {
  return (
    <div className="banner run-banner view-error">
      <span className="run-banner-text">
        Custom view “{failure.view}” failed: {failure.message}
      </span>
      <button className="link" onClick={onDismiss}>
        {stillShowing ? 'Dismiss' : 'Back to X'}
      </button>
      <button className="link" onClick={onFix}>
        Fix it
      </button>
    </div>
  );
}
