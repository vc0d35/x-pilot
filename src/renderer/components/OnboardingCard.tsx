export function OnboardingCard({
  libraryDir,
  onOpenSettings,
  onDismiss,
}: {
  libraryDir: string;
  onOpenSettings: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="setup">
      <div className="setup-title">XPilot: the agent sits beside x.com.</div>
      <ul className="onboard">
        <li>
          Ask about the post on screen, verify what it claims against the web, search the posts you liked, or save an article as a PDF.
        </li>
        <li>
          Posting asks you to confirm in the sidebar first;{' '}
          <button className="link" onClick={onOpenSettings}>
            Settings
          </button>{' '}
          can make it autonomous.
        </li>
        <li>
          The pill in the header names the model answering you;{' '}
          <button className="link" onClick={onOpenSettings}>
            Settings
          </button>{' '}
          → Models connects the other one and switches between them.
        </li>
        <li>Scheduled tasks only run while XPilot is open.</li>
        <li>
          PDFs are saved to <code>{libraryDir}</code> and listed under the library icon.
        </li>
      </ul>
      <div className="row">
        <button onClick={onDismiss}>Got it</button>
      </div>
    </div>
  );
}
