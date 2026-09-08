# XPilot

XPilot is a macOS desktop app that wraps [x.com](https://x.com) and puts an AI agent next to it. The agent runs on your own [Codex CLI](https://github.com/openai/codex) and can read what you are looking at, verify claims with web search, search the posts you liked, save posts and X Articles as PDFs, post on your behalf, drive your timeline, and run scheduled tasks while the app is open.

X offers nothing for agents, so XPilot injects its own adapter into the X page: a small, reviewable set of tools that read and drive the page, each with a name, a description and a JSON schema the model can reason about. The agent talks to X only through that surface, never through raw browser automation, and every tool that writes to your account can be set to ask first.

## Requirements

- macOS (Apple Silicon or Intel).
- Node.js 22.5 or newer (24 recommended). Unit tests use `node:sqlite`, which needs 22.5+.
- [Codex CLI](https://github.com/openai/codex) installed and logged in: `npm i -g @openai/codex && codex login`.
- An X account. You log in inside the app; nothing about your account is stored outside Electron's session.

## Run it locally

```bash
npm install
npm run dev
```

`npm run dev` builds with electron-vite in watch mode and starts Electron. Changes to the renderer hot-reload; changes to the main process or the preloads rebuild and restart the app.

The first launch opens x.com in the left pane and the agent sidebar on the right. The status dot in the sidebar header turns green once the Codex process is connected. If it stays on "codex login", run `codex login` in a terminal and click reconnect in Settings.

Useful environment variables:

| Variable | Effect |
| --- | --- |
| `XPILOT_USER_DATA=<dir>` | Use a separate profile (settings, history, X session). Handy for testing without touching your real login. |
| `XPILOT_CDP_PORT=9222` | Expose Chrome DevTools Protocol so you can inspect the live DOM with `scripts/inspect.mjs`. See `docs/manual-test.md`. |
| `XPILOT_TEAM_ID=<team id>` | Used by `npm run sign-dev` for passkey (Touch ID) support. See `docs/passkeys.md`. |
| `XPILOT_START_URL=<url>` | Open a different first page (used by the e2e tests). |
| `XPILOT_E2E=1` | Exposes a test harness on `globalThis` for Playwright. Never set this for normal use. |

### Passkeys (Touch ID)

X's passkey login only works when the app is signed with a keychain access group entitlement. That needs an Apple developer Team ID and a provisioning profile. The full walkthrough is in [docs/passkeys.md](docs/passkeys.md). Without it, everything else works; log in with a password or a code instead.

## Test

```bash
npm run typecheck   # tsc for the main/preload and renderer projects
npm test            # vitest unit tests (co-located *.test.ts next to the code)
npm run e2e         # builds, then Playwright launches the real Electron app against fixtures
```

Unit tests cover the DOM adapter against captured x.com fixtures in `tests/fixtures/`, the tool layer with fake views, the Codex protocol with a fake app-server, the history store, and the renderer state. The e2e suite starts Electron with a temporary profile and a local fixture page, so it needs no X login. Two tests that reach the live site are skipped unless you set `XPILOT_E2E_NETWORK=1`.

CI runs typecheck, unit tests and the build on every push and pull request (`.github/workflows/ci.yml`).

Some behaviour can only be checked against the real site. [docs/manual-test.md](docs/manual-test.md) is the checklist for that, and it explains how to attach to a running app over CDP to inspect what the adapter sees.

## Package

```bash
npm run dist
```

Builds, renders the entitlements and runs electron-builder for macOS. It writes a DMG and a ZIP for each architecture into `dist/`:

```
XPilot-<version>-arm64.dmg   XPilot-<version>-arm64.zip
XPilot-<version>-x64.dmg     XPilot-<version>-x64.zip
```

A fresh clone needs no secrets. Without an Apple certificate the build is unsigned, which is fine for personal use: macOS blocks the first launch, so right-click the app in Applications and choose Open, then confirm. Without `XPILOT_TEAM_ID` the passkey entitlement is left out (an app carrying it without a provisioning profile is killed at launch), so Touch ID login is off in that build; password and code login work. See [docs/passkeys.md](docs/passkeys.md) to build with passkeys.

Signed and notarized builds come from the tag workflow (`.github/workflows/release.yml`): pushing a `v*` tag runs typecheck, tests and the build, then publishes a draft GitHub release with the four artifacts attached. It signs and notarizes when these repository secrets exist, and produces unsigned artifacts when they do not: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, and optionally `XPILOT_TEAM_ID`. Remaining release work is tracked in [docs/release-todo.md](docs/release-todo.md).

## Learn more

- [docs/architecture.md](docs/architecture.md): how the pieces fit together, and the alternatives we considered.
- [docs/agent-principles.md](docs/agent-principles.md): how we prompt the agent (hints, not scripts).
- [docs/manual-test.md](docs/manual-test.md): manual checks and live DOM debugging.
- [docs/passkeys.md](docs/passkeys.md): signing for Touch ID passkeys.
- [docs/superpowers/specs](docs/superpowers/specs): the original design documents.

## License

XPilot is released under the [PolyForm Noncommercial License 1.0.0](LICENSE): you may use, modify and share it for any noncommercial purpose. Commercial use needs a separate agreement with the author. The bundled IBM Plex Mono font is under the SIL Open Font License, see `docs/licenses/`.
