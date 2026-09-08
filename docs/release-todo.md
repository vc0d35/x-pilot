# First official release: to-do

Goal: someone downloads XPilot on a Mac, opens it, logs into X, and it works. This list is ordered by what blocks that. Items marked *decision* need a call from the project owner.

## Decisions to make

- [ ] *decision* **License.** Pick one (MIT and Apache-2.0 are the usual choices for an app like this), add `LICENSE`, set `license` in `package.json`, and reference it in the README.
- [ ] *decision* **Public repository and author name.** Fill `repository`, `homepage` and `bugs` in `package.json`; decide what `author` should say.
- [ ] *decision* **Should scheduling a task ask for confirmation?** A scheduled task is a persistent grant: an injected instruction that reaches `xpilot_schedule_task` re-runs unattended. Posting confirms by default; tasks do not. Options: confirm on create, or show a persistent "N tasks scheduled" indicator with one-click review.
- [ ] *decision* **Where do the internal build plans live?** `docs/superpowers/plans` is ~5,300 lines of task-by-task build log, about 40% of the repo by lines. Keep for history, move to a `docs/history/` folder, or drop from the public tree.

## Packaging and signing

- [ ] **App icon.** `build/icon.icns` (1024×1024 source), plus the DMG background if we ship a DMG.
- [ ] **Distributable targets.** `electron-builder.yml` currently builds `dir` only. Add `dmg` and `zip`, for `arm64` and `x64` (or a universal build), and make `npm run dist` work from a fresh clone: the provisioning profile must be optional, and the entitlements template must render without `XPILOT_TEAM_ID`.
- [ ] **Developer ID signing.** A "Developer ID Application" certificate (paid Apple Developer account). Hardened runtime is already on; review `build/entitlements.mac.plist.in` so it carries only what the app needs.
- [ ] **Notarization and stapling.** Configure electron-builder's `notarize` with a notarytool keychain profile or `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` secrets. Verify with `spctl --assess` and a fresh-user-account launch (Gatekeeper prompt should be the friendly one).
- [ ] **Passkeys in the shipped build.** Touch ID login needs the keychain access group entitlement and an embedded provisioning profile issued for the Developer ID (the current personal-team profile is a 7-day wildcard). Either ship v1 without the entitlement (password and code login still work) and document it, or obtain the proper profile first. See `docs/passkeys.md`.
- [ ] **Keep packaging names in `electron-builder.yml` only.** A `productName` in `package.json` changes `app.getName()`, and with it the default profile folder under Application Support; adding one during release prep silently moved the dev app onto an empty profile. Packaged builds get their name from the builder config, so the packaged profile folder will be `XPilot` while dev stays `x-pilot`.
- [ ] **Versioning.** Move `package.json` to the release version, tag it, and add `CHANGELOG.md`.
- [ ] **Release workflow.** A GitHub Actions job on tag: `npm ci`, typecheck, tests, `npm run dist` with signing secrets, upload to GitHub Releases. The CI workflow for pushes and PRs already runs typecheck, tests and build.
- [ ] **Updates.** Add `electron-updater` against GitHub Releases, or at minimum a "check for updates" menu item that opens the releases page.

## First-run experience

- [ ] **Codex not found or not logged in.** The binary is now located across common install paths and the login shell, and there is a setting for a custom path. Turn the error status into a setup card in the sidebar with the exact commands (`npm i -g @openai/codex`, `codex login`) and a "try again" button.
- [ ] **Install instructions for Codex on a Mac without Node.** Document the Homebrew and standalone install options alongside npm.
- [ ] **Onboarding.** One screen on first launch: what the agent can do, that posting asks for confirmation by default, where PDFs go, and that scheduled tasks run only while the app is open.
- [ ] **Empty states** for History, Library and Tasks.
- [ ] **Offline start.** The app now survives a failed first load of x.com; check that the error page and the sidebar status make sense and that reconnecting works.

## Robustness follow-ups from the review

Done in the pre-release fix wave: permission handlers, renderer sandbox on for x.com, production CSP, dev-only switches gated on packaged builds, global `window.open` denial, PDF path containment, PDF-only opening, external-link rate limit, single-instance lock, crash handling, orderly quit, non-fatal startup load, task runs isolated from the user's window, Codex stderr drained, Codex binary discovery, approvals scoped to unexpected deaths, scheduler dedupe, SQLite migrations, atomic settings, transcript output cap, reopen tool-hash guard, deferred restart on settings change, `requestUserInput` refusal, prompt-injection fencing, bridge tool-list stability and navigation awareness, page-tool spec validation.

Still open:

- [ ] **Cancel in-flight tool calls on Stop.** Thread an `AbortSignal` from the provider through `registry.call` into `ToolModule.execute`; window-moving and destructive tools should check it before acting.
- [ ] **Serialise hidden-window use within one agent.** If the model issues parallel tool calls, two navigate-then-read sequences can interleave on the same hidden window. A per-view async mutex around navigate + read, or a small pool of hidden windows, fixes it.
- [ ] **Compile-time adapter tool specs in main.** The tool list is learned from the preload at registration, so the first thread waits for the page and the fingerprint depends on timing. Splitting specs from execute functions lets main hold the specs as constants.
- [ ] **`requestUserInput` UI.** Route Codex clarifying questions to a sidebar prompt instead of refusing them.
- [ ] **Transcript retention.** Output is capped per event; add a retention policy (recent N conversations or age) and show database size in Settings.
- [ ] **Health signals.** `adapterHealthy` only checks the main column; add per-extractor signals (posts found on a timeline page, article body found) so markup changes are caught early.
- [ ] **Turn timeout.** A wedged Codex process still shows as running; add a wall-clock guard with a user-visible way out.

## Code organisation follow-ups (not blockers)

- [ ] Split `src/main/index.ts` into entry, service bootstrap and link routing.
- [ ] Split `src/main/agent/codex/provider.ts` into process lifecycle, turn text and event mapping.
- [ ] Split `HistoryStore` into per-domain stores over one connection, and rename it (it stores more than history).
- [ ] Parse tool arguments with zod schemas instead of per-tool `typeof` coercions.
- [ ] Deduplicate `contextKey` / `contextSignature` into a shared module.
- [ ] Move renderer-only settings policy (`confirmPostingMode`, `AUTONOMOUS_WARNING`) and the `threadId` / `threadToolsHash` agent state out of `src/shared/settings.ts`.
- [ ] Share the library folder name between main and `SettingsPanel`.
- [ ] Add ESLint (typescript-eslint flat config) and a formatter; enforce in CI.
- [ ] Run the hermetic e2e suite in CI; keep the network tests behind `XPILOT_E2E_NETWORK=1`.

## Documentation and project hygiene

- [ ] README screenshots or a short GIF of the sidebar in use.
- [ ] `SECURITY.md` with a disclosure contact; `CONTRIBUTING.md`; a code of conduct if the project accepts contributions.
- [ ] A short privacy note: what is stored (X session in Electron's profile, liked posts and transcripts in SQLite, PDFs in Documents), what leaves the machine (only what Codex sends to its model, plus web search when enabled), and how to wipe it.
- [ ] Refresh `docs/manual-test.md` and run the full checklist on a signed, packaged build on both Apple Silicon and Intel, from a fresh macOS user account.
