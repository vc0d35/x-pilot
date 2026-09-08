# First official release: to-do

Goal: someone downloads XPilot on a Mac, opens it, logs into X, and it works. This list is ordered by what blocks that. Items marked *decision* need a call from the project owner.

## Decisions to make

- [x] *decision* **License.** PolyForm Noncommercial 1.0.0: `LICENSE`, `package.json` and the README agree.
- [x] *decision* **Public repository and author name.** `github.com/vc0d35/x-pilot`, author `vc0d35`.
- [ ] *decision* **Should scheduling a task ask for confirmation?** A scheduled task is a persistent grant: an injected instruction that reaches `xpilot_schedule_task` re-runs unattended. Posting confirms by default; tasks do not. Options: confirm on create, or show a persistent "N tasks scheduled" indicator with one-click review.
- [x] *decision* **Internal build plans stay out of the public repo.** `docs/superpowers/plans` is removed; the design specs stay.

## Packaging and signing

- [ ] **App icon.** `build/icon.icns` (1024×1024 source), plus the DMG background. The config already points at `build/icon.icns`; dropping the file in is enough. Until then electron-builder warns and uses the default Electron icon.
- [x] **Distributable targets.** `electron-builder.js` (replacing the YAML, so the config can branch on the environment) builds `dmg` and `zip` for `arm64` and `x64`, named `XPilot-<version>-<arch>.<ext>` into `dist/`. `npm run dist` works from a fresh clone: the provisioning profile is included only when `build/embedded.provisionprofile` exists, and `scripts/render-entitlements.mjs` renders without `XPILOT_TEAM_ID` by dropping the keychain group.
- [ ] **Developer ID signing.** A "Developer ID Application" certificate (paid Apple Developer account). Hardened runtime is already on; review `build/entitlements.mac.plist.in` so it carries only what the app needs. The workflow consumes the certificate as `CSC_LINK` / `CSC_KEY_PASSWORD`; with no `CSC_LINK` it sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and ships unsigned.
- [ ] **Notarization and stapling.** `mac.notarize` turns itself on when `APPLE_KEYCHAIN_PROFILE`, or `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`, are in the environment, and stays off otherwise. Still to do: add the secrets and verify a real run with `spctl --assess` and a fresh-user-account launch (the Gatekeeper prompt should be the friendly one).
- [ ] **Passkeys in the shipped build.** Touch ID login needs the keychain access group entitlement and an embedded provisioning profile issued for the Developer ID (the current personal-team profile is a 7-day wildcard). v1 currently ships without the entitlement: no `XPILOT_TEAM_ID` secret and no committed profile, so password and code login only. Setting `XPILOT_TEAM_ID` in CI without also shipping `build/embedded.provisionprofile` produces an app macOS kills at launch. See `docs/passkeys.md`.
- [x] **Keep packaging names in the builder config only.** `package.json` still has no `productName`; the packaged app is named from `electron-builder.js`, so the packaged profile folder is `XPilot` while dev stays `x-pilot`.
- [ ] **Versioning.** `CHANGELOG.md` exists (Keep a Changelog, everything so far under Unreleased). Still to do: move `package.json` to the release version, move the entries under that heading, and tag.
- [x] **Release workflow.** `.github/workflows/release.yml` runs on `v*` tags: `npm ci`, typecheck, tests, then `electron-builder --mac --publish always`, which creates a draft GitHub release named after the tag with the artifacts attached. Secrets it reads: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `XPILOT_TEAM_ID` (`GH_TOKEN` comes from the job token). All are optional; the build succeeds unsigned when they are absent.
- [ ] **Updates.** Help → "Check for Updates…" opens the releases page, and "Report an Issue…" opens the issue tracker. Real in-app updates still need `electron-updater` against GitHub Releases (the `publish` block in the builder config is already the GitHub provider, so the feed exists).

## First-run experience

- [x] **Codex not found or not logged in.** Located across common install paths and the login shell, with a settings override; the child gets the binary's directory and the login-shell PATH so the `#!/usr/bin/env node` shim works from Finder (verified on a packaged build). The sidebar shows a setup card with the exact commands and a Try again button.
- [ ] **Install instructions for Codex on a Mac without Node.** Document the Homebrew and standalone install options alongside npm.
- [x] **Onboarding.** A one-time card on first launch, dismissed for good with "Got it".
- [x] **Empty states** for History, Library and Tasks.
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
- [ ] **Codex children after a hard kill.** SIGTERM and SIGINT now go through `app.quit()` so the agent is stopped, but a SIGKILL of the app leaves `codex app-server` running (it does not exit when its stdin closes). Options: a watchdog argument if Codex grows one, or a launcher that kills the process group.
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
