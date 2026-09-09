# XPilot architecture

XPilot is a desktop shell around x.com with an agent next to it. The agent runs on the user's own Codex CLI, and it reaches X through a small set of tools that we control. This document explains how the pieces fit, why they are shaped the way they are, and what we considered instead.

## 1. Processes and windows

```
┌──────────────────────────── Electron main process ─────────────────────────────┐
│  settings.json   history.sqlite   tool registry   agent controller   tasks     │
│        │               │               │                 │             │        │
│        │               │        ┌──────┴──────┐   codex app-server   codex     │
│        │               │        │ tool sources│   (interactive)      (per run) │
│        │               │        │ adapter bridge│       stdio JSON-RPC          │
│        │               │        │ xview tools  │                                │
│        │               │        │ app tools    │                                │
│        │               │        └──────┬──────┘                                │
└────────────────────────────────────────┼───────────────────────────────────────┘
        IPC (sender-checked)             │ IPC (sender-checked)
┌──────────────────────┐   ┌─────────────┴──────────┐   ┌───────────────────────┐
│ Sidebar view         │   │ X view (visible)       │   │ Hidden X windows      │
│ React, sandboxed,    │   │ x.com, persist:x,      │   │ same session, one for │
│ own preload, CSP     │   │ isolated preload with  │   │ the agent, one for    │
│                      │   │ the adapter tools      │   │ scheduled runs; PDF   │
│                      │   │                        │   │ export window         │
└──────────────────────┘   └────────────────────────┘   └───────────────────────┘
```

One `BaseWindow` hosts two `WebContentsView`s: the X page on the left and our React sidebar on the right. `computeLayout` in `src/main/layout.ts` is a pure function of window size and collapsed state; when the sidebar is collapsed it shrinks to a floating handle so the page gets the whole width.

Reads that must not disturb the user go to a hidden `BrowserWindow` on the same `persist:x` session, so it shares the login. The interactive agent and scheduled task runs each get their own hidden window so they never race each other for the page. PDF export uses a third short-lived hidden window.

Every Codex conversation is a separate `codex app-server` child process speaking newline-delimited JSON-RPC over stdio. The interactive sidebar owns one long-lived process; each scheduled task run spawns its own and tears it down afterwards.

## 2. The X adapter

X offers nothing for agents, so we make the page agent-drivable ourselves. The X view's preload runs in Electron's isolated world with `contextIsolation` and the renderer sandbox on, where page scripts cannot see or alter it. It does two things:

- **Registers adapter tools** with the main process over IPC. Each tool is a `ToolModule` with a JSON-schema `spec` and an `execute` that reads or drives the DOM. Reads use extractors in `src/preload/x/adapter/extract.ts` and `widgets.ts`; every CSS selector lives in `selectors.ts`, so an X markup change is a one-file fix. Fixtures captured from the real site in `tests/fixtures/` keep the extractors honest.
- **Tracks focus.** `computeFocus` derives what the user is looking at (a post page, a reply dialog, the posts on screen) and sends a `PageContext` to the sidebar, which prepends it to the next message as a hint. Liking a post is captured with a pointerdown snapshot so the liked-posts index only ever stores posts the user chose to like.

Health is reported rather than assumed: `x_get_page_state` waits for X's layout to render and returns `adapterHealthy: false` when it cannot find it, and the agent is told to say so.

## 3. The tool layer

`src/shared/tools.ts` defines the contract: a `ToolSpec` (name, description, input schema, annotations) and a `ToolResult` that is either `ok(content)` or `fail(error)`. A `ToolRegistry` merges tool sources by name; later sources win, and tools annotated `internal` are callable by main but hidden from the model. There are three sources:

| Source | Runs in | Examples |
| --- | --- | --- |
| adapter bridge | the visible X view's preload | `x_get_page_state`, `x_read_visible_posts`, `x_scroll`, `x_show_new_posts` |
| xview tools | main, driving a view | `x_read_post`, `x_search`, `x_read_timeline`, `x_read_news_and_trends`, `x_like_post`, `x_compose_post`, `x_submit_post`, `x_navigate` |
| app tools | main, app services | `xpilot_search_history`, `xpilot_save_article_pdf`, `xpilot_list_library`, `xpilot_schedule_task` |

Two rules shape the xview tools. First, **background by default**: reading, searching and verifying happen in a hidden window, and only tools that the user's intent clearly points at the screen (`x_navigate`, `x_scroll`, `view: "visible"`) move the visible view. Second, **user decisions are final**: anything that writes to the account goes through the `ApprovalBroker` when the relevant setting says confirm, and a decline comes back as `status: 'cancelled_by_user'`, not as an error, so the model does not retry.

Scheduled runs get a second registry whose "visible view" is a stub that refuses, so an unattended run can never hijack the user's screen.

Adding a tool is one file: export a `ToolModule` and add it to the source's list. Adding a source is a class with `list()` and `call()`.

## 4. The agent layer

`CodexProvider` wraps one `codex app-server` process. It sends `initialize`, starts or resumes a thread with our tool specs as `dynamicTools`, and turns server notifications into a small `AgentEvent` vocabulary the renderer understands: status, message deltas, thinking, tool started and completed, activity, web-search items, approvals. Server-initiated `item/tool/call` requests are routed to the registry and answered with the tool result, wrapped as untrusted page data.

`AgentController` owns thread lifecycle. Codex fixes a thread's tools at `thread/start`, so the controller fingerprints the tool list and starts a fresh thread when the fingerprint changes rather than resuming a thread that believes in a different tool set. It records every event into the conversation log so the History panel can replay it.

Prompting follows `docs/agent-principles.md`: hints, not scripts. The developer instructions state a handful of rules (background by default, verify with web sources, decisions are final, two-step posting, schedule recurring requests) and leave tool selection and interpretation to the model.

Scheduled tasks live in the `tasks` table with a schedule (`every` or cron), a prompt written by the agent as complete instructions for an unattended run, and a thread mode. `TaskManager` ticks every 30 seconds, enqueues due tasks once, and runs them one at a time; `TaskRunner` spawns a provider per run with a 10-minute limit. Tasks run only while the app is open.

## 5. Data

- `settings.json` holds user settings, window bounds and the live thread id, validated with zod and written atomically.
- `history.sqlite` (Node's built-in `node:sqlite`, WAL mode, versioned migrations) holds liked posts with an FTS5 index, the PDF library, conversations and their event logs, and scheduled tasks. Tool output in the transcript is capped so the log stays small.
- PDFs go to `~/Documents/X Pilot` by default; paths are contained to that folder before anything is written or opened.
- Nothing about the X account leaves Electron's session store. Codex authentication belongs to the Codex CLI.

## 6. Security model

The X page is untrusted remote content that runs third-party scripts, and the agent can write to a logged-in account. The defences, from the outside in:

- **Renderer isolation.** All views run with `contextIsolation` and the Chromium sandbox; preloads are self-contained bundles, and the sidebar has a strict CSP in production. Packaged builds set Electron's fuses: cookies are encrypted with a key in the user's keychain, the binary cannot run as Node, `NODE_OPTIONS` and inspector arguments are ignored, and only the integrity-checked asar can be loaded.
- **Navigation policy.** Every WebContents the app creates gets the policy, including popups opened by popups and the PDF exporter, and it covers subframes. In-app navigation is limited to https on x.com, twitter.com and t.co. Login providers open in a popup without our preload. Everything else goes to the system browser through a rate-limited `shell.openExternal`; t.co links are resolved in main with https-only, bounded hops. `window.open` is denied everywhere by default.
- **Permissions.** Session permission handlers deny everything except fullscreen and sanitised clipboard writes, and grant those only to allowlisted https origins in the main frame.
- **IPC.** Every handler checks the sender's `WebContents` id and validates payloads with zod, including settings patches. Liked-post events are accepted only from trusted user clicks, with capped fields and a rate limit. The sidebar API is only reachable from our own renderer.
- **Prompt injection.** Page text reaches the model in three ways: the focus hint, tool results, and the prompts of scheduled tasks. All of it, including author names and URLs, is fenced as untrusted data with escaped delimiters, and the instructions say so. Authorship comes from permalinks, never from display names. Writes are gated by settings: posting and likes confirm by default, the approval card cannot be scrolled away from its buttons, and Codex's own command approvals stay on. `x_navigate` refuses URLs that act on load, such as logout, settings and intents.
- **Containment.** PDF filenames are derived from the requested URL and sanitised metadata, the export aborts if the page moved, and paths are checked against the library folder; only `.pdf` files inside it can be opened. Profile files are created private to the user.
- **Codex.** The binary is taken from an explicit setting, PATH, or the login shell before any guessed directory, and must be a regular file owned by the user or root that nobody else can write.
- **Dev-only switches** (test harness, DevTools Protocol port, custom start URL, custom profile) are ignored in packaged builds.

Residual risks worth knowing: a prompt injection can still steer read-only tools and anything the user set to autonomous; the DOM adapter breaks when X changes markup, which shows up as `adapterHealthy: false`; and scheduled tasks act without a human present, by design.

## 7. The renderer

The sidebar is a small React app. State is a reducer over `AgentEvent`s, so a live turn and a replayed conversation render through the same code. Consecutive tool calls collapse into one group, thinking collapses to one row per turn, and agent messages render as Markdown with links routed by the same policy as page links.

## 8. Alternatives we considered

**Electron shell vs browser extension.** An extension could inject the same adapter into x.com in the user's normal browser, but it cannot spawn Codex, cannot open a hidden same-session window, cannot save PDFs to disk, and would depend on the browser's extension APIs for the sidebar. Electron gives us the process model and the hidden windows at the cost of shipping a browser.

**`WebContentsView` vs `<webview>` tag vs iframe.** An iframe cannot host x.com. The `<webview>` tag is discouraged by Electron and blurs the preload boundary. Two `WebContentsView`s in a `BaseWindow` keep the X page and our UI in separate processes with separate preloads and let the layout be a pure function.

**DOM adapter vs X's private API vs computer use.** Reading X through its GraphQL endpoints with the session cookies would be more robust to markup changes and trivially concurrent, but it depends on undocumented endpoints and looks like automation to anti-abuse systems. Driving the page by screenshots and clicks is general but slow, expensive and brittle. A DOM adapter behind a stable tool surface is the middle path: selectors change occasionally, and when they do the fix is one file with a fixture.

**Codex app-server vs calling a model API directly vs an MCP server.** Calling a model API directly would mean our own agent loop, our own auth and billing, and no reuse of the user's Codex setup. Exposing our tools as an MCP server that Codex connects to would work, but it inverts control: the app would not know when a turn starts or ends, could not stream activity, and could not resume threads. The app-server protocol gives us threads, streaming, approvals and client-supplied tools over stdio, with the user's existing login. The cost is coupling to one provider; the `AgentProvider` interface is where a second one would plug in.

**One Codex process per task run vs one multiplexed process.** The protocol is thread-addressed, so one process could serve everything and avoid per-run spawn latency. We chose a process per run so a wedged or crashed unattended run cannot take the user's interactive session down with it.

**Owning the transcript in SQLite vs replaying Codex's thread.** Rebuilding the UI from Codex's own thread on open would avoid duplication, but it welds the UI to one provider and loses everything when a thread expires. Owning the event log makes the History panel, task-run records and full-text search possible.

**`node:sqlite` vs better-sqlite3.** The built-in module needs no native build step per Electron version and ships FTS5. It is still marked experimental by Node, so the store is kept behind a small class so it could be swapped.

**A page-side WebMCP polyfill.** Early versions also installed a `document.modelContext` polyfill in the page's main world so that tools registered by X or an embedded page would surface to the agent. No site registers such tools, our own adapter tools never used that path (they live in the isolated world precisely so page scripts cannot tamper with them), and the polyfill was a main-world surface any script on x.com could reach. We removed it. The adapter tools keep the WebMCP tool shape, so if X ever ships the real API it can be consumed alongside them.

**Principles vs scripted flows in the prompt.** Enumerating every way a user might refer to the post on their screen would be brittle and token-hungry. The instructions state principles and provide the current page as a hint; the model deduces the rest. See `docs/agent-principles.md`.

## 9. Known limitations

- Tool calls are not cancelled when a turn is interrupted; a navigation already in flight completes.
- The interactive agent's own tools are not serialised against each other if the model issues parallel calls that both navigate the hidden window.
- Adapter tool specs are learned from the preload at registration rather than being compile-time constants in main, so the first thread waits for the page to load.
- macOS only for now; passkeys need a signed build with a provisioning profile (see `docs/passkeys.md`).
