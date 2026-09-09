# Contributing

Thanks for looking at XPilot. Bug reports, fixes and small, focused features are welcome. Security problems go through [SECURITY.md](SECURITY.md), not the issue tracker.

## Before you start

- Read [docs/architecture.md](docs/architecture.md) for how the pieces fit, and [docs/agent-principles.md](docs/agent-principles.md) for how we talk to the model: hints, not scripts.
- For anything bigger than a bug fix, open an issue first describing the change and why. It saves both of us a rewrite.

## Setup

```bash
npm install
npm run dev
```

You need Node 22.5 or newer, the Codex CLI installed and logged in, and an X account to test against. `XPILOT_USER_DATA=$(mktemp -d) npm run dev` gives you a throwaway profile. The README covers the rest.

## Checks

Every pull request must pass what CI runs:

```bash
npm run typecheck
npm run lint
npm run format:check   # or: npm run format
npm test
npm run build
npm run e2e
```

Unit tests live next to the code as `*.test.ts`. The DOM adapter is tested against captured x.com markup in `tests/fixtures/`; if X changes and you fix a selector, add or update the fixture that proves it.

## Conventions

- **One tool per file**, defined with `defineTool` and a zod `args` schema. Descriptions are written for the model: say what the tool does and when it is the right choice, not a procedure.
- **Selectors live in `src/shared/selectors.ts` only.** Never inline an x.com selector elsewhere.
- **Comments only where the reason is not obvious** from the code: a platform quirk, a workaround, a security invariant. No comments that restate what the code does.
- **Background by default.** A tool that reads X uses the hidden window; the visible window moves only on the user's explicit intent.
- **User decisions are final.** A declined confirmation is an outcome the model must accept, not an error to retry.
- Prettier formats, ESLint checks; both are enforced. Keep pull requests small and behaviour-neutral refactors separate from features.

## Pull requests

- One change per pull request, with a description that says what and why.
- Include tests for new behaviour and a `CHANGELOG.md` line under Unreleased.
- Manual checks that can only be done against the live site go in `docs/manual-test.md`.

## Licence

XPilot is released under the PolyForm Noncommercial License 1.0.0. By contributing you agree that your contribution is licensed under the same terms.
