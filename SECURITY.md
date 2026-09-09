# Security policy

XPilot drives a logged-in X account and runs an AI agent against text from the open web, so security reports are taken seriously and answered quickly.

## Reporting a vulnerability

Please do not open a public issue for anything that could be a security problem.

- Email **me@vicnicius.com**. Encrypt to the PGP key below if the report contains an exploit, a session token, or anything else you would not put in a public place.
- Or use GitHub's private reporting on this repository: Security tab → "Report a vulnerability".

PGP key: [`docs/pgp-key.asc`](docs/pgp-key.asc), fingerprint

```
89E2 2C01 C390 D012 D06E  83E5 EC87 6AC4 C939 054D
```

Include what you can of: the version or commit, the steps or a proof of concept, what an attacker gains, and whether you have seen it exploited. A minimal reproduction against a throwaway X account is ideal.

## What to expect

- An acknowledgement within 72 hours.
- An assessment and a plan within 7 days, and a fix for confirmed issues as fast as severity warrants; critical issues that affect the X session or allow silent writes to an account are treated as blocking.
- Credit in the release notes if you want it. Coordinated disclosure after the fix ships, or after 90 days, whichever comes first, unless we agree otherwise.

## Scope

In scope: everything in this repository, including the Electron shell, the X page adapter and its injected tools, the agent tool layer, prompt-injection boundaries, the sidebar, local storage, packaging and the release workflow.

Out of scope: vulnerabilities in x.com itself, in the Codex CLI, or in Electron and Chromium (report those upstream; tell us if XPilot is affected in a specific way), issues that require a compromised user account on the same machine beyond what `docs/architecture.md` already lists as a residual risk, and denial of service against your own installation.

## Safe harbour

Good-faith research that respects other users and X's own terms, stays on accounts you own, and does not access or alter anyone else's data is welcome. We will not pursue action against researchers who follow this policy.

## Design notes

The threat model and the defences in place are described in `docs/architecture.md`, section 6, and what the app stores and sends is described in `docs/privacy.md`.
