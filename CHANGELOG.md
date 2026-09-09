# Changelog

All notable changes to XPilot are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Agent sidebar next to x.com, driven by your local Codex CLI, with a per-conversation transcript and history.
- Page tools the agent uses instead of raw automation: reading the timeline, posts, threads, X Articles, profiles, notifications, and the Today's News and What's happening widgets.
- Background reads in a hidden window, so the agent can open and read a post without moving the page you are on.
- Search over the posts you liked, stored locally in SQLite.
- Save posts and X Articles as PDFs in a library folder under Documents.
- Posting, replying and liking on your behalf, asking for confirmation by default.
- Scheduled tasks that run while the app is open, isolated from the window you are using.
- Touch ID passkey login for signed builds with a provisioning profile (see `docs/passkeys.md`).
- Help menu with "Check for Updates…" and "Report an Issue…".
- `npm run dist` produces DMG and ZIP artifacts for arm64 and x64; tag pushes publish a draft GitHub release.

- Stop cancels in-flight tool calls; turns idle for five minutes are failed with a hint. Codex clarifying questions appear as a card in the sidebar. Transcript retention and database size in Settings. Scheduled tasks opt in to web search per task. Page health reported per extractor.

- Page styles: a user-editable `page-styles.css` applied to the X view before it renders; the agent can read, replace or reset it, with an Apply card by default.
- Configurable selectors: `selectors.json` overrides the adapter's read selectors, kept across app updates and flagged stale when a shipped default changes; the agent can list, test, inspect markup, set and reset them. Action selectors are locked to hand edits.

### Security

- Renderer sandbox and a production CSP for the x.com view, hardened `webContents` defaults, and dev-only switches gated on unpackaged builds.
- Permission handlers, global `window.open` denial, external-link rate limiting and a single-instance lock.
- PDF writes contained to the library folder, and only PDFs may be opened from it.
- Prompt-injection fencing around page content, tool-list stability checks, and validation of adapter tool specs.
- Whole-application security review fixes: Electron fuses set in packaged builds (encrypted cookies, no run-as-node, no NODE_OPTIONS or inspect arguments, asar-only with integrity), profile files private to the user, Codex located from PATH and the login shell before guessed directories and only as a safe executable, settings patches validated, every page-derived field fenced before it reaches the model, scheduled-task prompts fenced in unattended runs, navigation policy on every window including popups of popups and the PDF exporter, subframes covered, permissions scoped to allowlisted origins, untrusted clicks ignored by like capture with capped and rate-limited payloads, authorship derived from permalinks only, likes confirm by default, action URLs refused by `x_navigate`, bounded approval cards with pinned buttons, deceptive link text labelled with its real host, release workflow pinned by SHA and refusing unsigned builds unless explicitly dispatched.
