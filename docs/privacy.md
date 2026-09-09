# Privacy

XPilot has no server, no accounts of its own, and no telemetry. Everything it keeps lives on your Mac, and the only things that leave it are what you already send to X and what the Codex CLI sends to its model.

## What is stored, and where

Everything below is in your profile folder, private to your user account:

- `~/Library/Application Support/XPilot` for the packaged app, or `x-pilot` when running from source.

| Data                                                       | Where                               | Notes                                                                                                          |
| ---------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Your X session (cookies, local storage)                    | `Partitions/x` inside the profile   | Chromium's own store. Packaged builds encrypt cookies with a key in your keychain.                             |
| Posts you liked                                            | `history.sqlite`                    | Only posts you liked yourself, captured from your clicks, with a full-text index so the agent can search them. |
| Conversations with the agent and scheduled-run transcripts | `history.sqlite`                    | Tool output is capped per event; a retention policy in Settings prunes old conversations.                      |
| Scheduled tasks                                            | `history.sqlite`                    | Title, prompt, schedule, last run and the newest post seen.                                                    |
| Settings                                                   | `settings.json`                     | Model, modes, library folder, retention, window position.                                                      |
| Agent thread state                                         | `agent-state.json`                  | The id of the live Codex thread.                                                                               |
| Page styles and selector overrides                         | `page-styles.css`, `selectors.json` | Editable text files.                                                                                           |
| Saved PDFs                                                 | `~/Documents/X Pilot` by default    | Change the folder in Settings.                                                                                 |

Codex keeps its own login and its conversation history under `~/.codex`; XPilot does not read them.

## What leaves your Mac

- **To X:** only what your browser session would send anyway, plus the actions you or the agent take on your behalf (likes, posts) under the confirmation settings you chose.
- **To the model behind Codex:** the text of your messages, the page context the sidebar shows you, tool results (page text the agent reads, search results, your liked-post search hits), and scheduled-task prompts. This is sent by the Codex CLI to the model provider you logged in with, under that provider's terms.
- **Web search:** when enabled, Codex sends its search queries to its search provider. Every query is shown in the sidebar. Scheduled tasks have web search off unless the task asks for it.
- **Nothing else.** No analytics, crash reports, or update pings. "Check for Updates" only opens the releases page in your browser.

## How to wipe it

- **Conversations and liked posts:** Settings → "Clear history" removes them from `history.sqlite`.
- **Everything, including the X session:** quit XPilot and delete the profile folder above. The next launch starts fresh and asks you to log in to X again.
- **PDFs:** delete the library folder, or individual files.
- **Codex:** `codex logout`, and delete `~/.codex` if you want its history gone too.
