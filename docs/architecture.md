# XPilot architecture

XPilot is a desktop shell around x.com with an agent next to it. The agent runs on the user's own Codex CLI, and it reaches X through a small set of tools that we control. This document explains how the pieces fit, why they are shaped the way they are, and what we considered instead.

## 1. Processes and windows

```
┌──────────────────────────── Electron main process ─────────────────────────────┐
│  settings.json   history.sqlite   tool registry   agent controller   tasks     │
│        │               │               │                 │             │        │
│        │               │        ┌──────┴──────┐   codex app-server   codex     │
│        │               │        │ tool sources│   (interactive)      (per run) │
│        │               │        │ webmcp bridge│        stdio JSON-RPC          │
│        │               │        │ xview tools  │                                │
│        │               │        │ app tools    │                                │
│        │               │        └──────┬──────┘                                │
└────────────────────────────────────────┼───────────────────────────────────────┘
        IPC (sender-checked)             │ IPC (sender-checked)
┌──────────────────────┐   ┌─────────────┴──────────┐   ┌───────────────────────┐
│ Sidebar view         │   │ X view (visible)       │   │ Hidden X windows      │
│ React, sandboxed,    │   │ x.com, persist:x,      │   │ same session, one for │
│ own preload, CSP     │   │ isolated preload with  │   │ the agent, one for    │
│                      │   │ adapter tools + WebMCP │   │ scheduled runs; PDF   │
│                      │   │ polyfill               │   │ export window         │
└──────────────────────┘   └────────────────────────┘   └───────────────────────┘
```

One `BaseWindow` hosts two `WebContentsView`s: the X page on the left and our React sidebar on the right. `computeLayout` in `src/main/layout.ts` is a pure function of window size and collapsed state; when the sidebar is collapsed it shrinks to a floating handle so the page gets the whole width.

Reads that must not disturb the user go to a hidden `BrowserWindow` on the same `persist:x` session, so it shares the login. The interactive agent and scheduled task runs each get their own hidden window so they never race each other for the page. PDF export uses a third short-lived hidden window.

Every Codex conversation is a separate `codex app-server` child process speaking newline-delimited JSON-RPC over stdio. The interactive sidebar owns one long-lived process; each scheduled task run spawns its own and tears it down afterwards.

## 2. The X adapter

X does not implement WebMCP, so we make the page agent-drivable ourselves. The X view's preload runs in Electron's isolated world with `contextIsolation` and the renderer sandbox on. It does three things:

- **Registers adapter tools** with the main process over IPC. Each tool is a `ToolModule` with a JSON-schema `spec` and an `execute` that reads or drives the DOM. Reads use extractors in `src/preload/x/adapter/extract.ts` and `widgets.ts`; every CSS selector lives in `selectors.ts`, so an X markup change is a one-file fix. Fixtures captured from the real site in `tests/fixtures/` keep the extractors honest.
- **Tracks focus.** `computeFocus` derives what the user is looking at (a post page, a reply dialog, the posts on screen) and sends a `PageContext` to the sidebar, which prepends it to the next message as a hint. Liking a post is captured with a pointerdown snapshot so the liked-posts index only ever stores posts the user chose to like.
- **Injects a WebMCP polyfill** into the page's main world so that, if X or any embedded page ever registers `document.modelContext` tools, they surface through `x_list_page_tools` and `x_call_page_tool`. Page-registered tools are never merged into the agent's tool list; they are data the agent can inspect.

Health is reported rather than assumed: `x_get_page_state` waits for X's layout to render and returns `adapterHealthy: false` when it cannot find it, and the agent is told to say so.

## 3. The tool layer

`src/shared/tools.ts` defines the contract: a `ToolSpec` (name, description, input schema, annotations) and a `ToolResult` that is either `ok(content)` or `fail(error)`. A `ToolRegistry` merges tool sources by name; later sources win, and tools annotated `internal` are callable by main but hidden from the model. There are three sources:

| Source | Runs in | Examples |
| --- | --- | --- |
| WebMCP bridge | the visible X view's preload | `x_get_page_state`, `x_read_visible_posts`, `x_scroll`, `x_show_new_posts` |
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

- **Renderer isolation.** All views run with `contextIsolation` and the Chromium sandbox; preloads are self-contained bundles, and the sidebar has a strict CSP in production.
- **Navigation policy.** The X view may only navigate to x.com, twitter.com and t.co. Login providers open in a popup without our preload. Everything else goes to the system browser through a rate-limited `shell.openExternal`; t.co links are resolved in main first. `window.open` is denied everywhere by default.
- **Permissions.** Session permission handlers deny camera, microphone, geolocation, notifications and device access.
- **IPC.** Every handler checks the sender's `WebContents` id and validates payloads with zod. The sidebar API is only reachable from our own renderer.
- **Prompt injection.** Page text reaches the model in two ways: the focus hint and tool results. Both are fenced as untrusted data with escaped delimiters, and the instructions say so. Writes are gated by settings: posting confirms by default, likes have a confirm option, and Codex's own command approvals stay on.
- **Containment.** PDF filenames are derived from sanitised metadata and checked against the library folder; only `.pdf` files inside it can be opened.
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

**Injecting a WebMCP polyfill vs waiting for sites to ship it.** The polyfill is cheap and forward-looking, and it demonstrates the W3C shape end to end in the e2e fixture. Since no site registers tools today, it is a capability rather than a feature, and it can be dropped if it ever becomes a liability.

**Principles vs scripted flows in the prompt.** Enumerating every way a user might refer to the post on their screen would be brittle and token-hungry. The instructions state principles and provide the current page as a hint; the model deduces the rest. See `docs/agent-principles.md`.

## 9. Known limitations

- Tool calls are not cancelled when a turn is interrupted; a navigation already in flight completes.
- The interactive agent's own tools are not serialised against each other if the model issues parallel calls that both navigate the hidden window.
- Adapter tool specs are learned from the preload at registration rather than being compile-time constants in main, so the first thread waits for the page to load.
- macOS only for now; passkeys need a signed build with a provisioning profile (see `docs/passkeys.md`).
