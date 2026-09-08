# X Pilot manual test (real x.com)

Run `npm run dev`, logged into x.com in the X view.

## Navigation
- [ ] Clicking a t.co link in a post opens the target in the system browser; the X view stays on x.com.
- [ ] Google/Apple sign-in popups (if used) open in-app; other popups go external.

## Agent
- [ ] Header reaches `ready`; an error banner appears if `codex login` is needed.
- [ ] "Which page am I on?" → `x_get_page_state` tool row, correct answer.
- [ ] Stop button interrupts a long answer.
- [ ] Open a post with a factual claim and ask "is this true?" → a `web_search` tool row appears and the answer cites non-X sources; Settings → Web search → Off makes the agent stop searching the web.
- [ ] Ctrl+D from anywhere (even with the sidebar collapsed) focuses the agent input.
- [ ] Header chevron hides the sidebar entirely (x.com fills the window); View → Toggle Sidebar or ⌘\ brings it back with the conversation intact.
- [ ] New thread clears the list; a settings change (model) restarts and resumes the thread.
- [ ] Quit and relaunch; ask "which page am I on?" → the agent still calls a tool (thread resumed with tools).

## Focus context
- [ ] Open a post; "is this true?" is answered about that post (the focused post is sent with the turn; no chip is shown).
- [ ] Reply dialog on the timeline → questions refer to the post being replied to.

## Reading
- [ ] "Summarise the visible posts" on Home.
- [ ] "Read <post url>" returns the thread text WITHOUT moving the visible window (it runs in the hidden session window).
- [ ] "Search X for electron and show me" → the visible window navigates to the results (view: visible).
- [ ] "Roll my timeline until you find a post by @dhh" → the visible window scrolls (x_scroll + x_read_visible_posts).
- [ ] Open an X Article; "summarise this article" returns title + body.
- [ ] Open an X Article directly by URL (not from the timeline): "summarise this article" works and the chip shows the article title.

## Liked history
- [ ] Like two posts; "what did I like about <word>?" finds them.
- [ ] Unlike one; it still shows up with `unlikedAt`.
- [ ] Settings → Clear history → 0 results.

## Posting
- [ ] Confirm mode: draft appears in composer, sidebar card shows the exact text; Cancel returns home; Post publishes.
- [ ] Reply: "reply to <url> with 'thanks'" → reply is threaded correctly.
- [ ] Autonomous mode: posts without a card; header toggle shows the warning colour.

## PDF
- [ ] "Save this as a PDF" on a long post and on an X Article → file in the library folder, no nav chrome, text expanded.
- [ ] Library panel lists it; Open PDF works; Change folder persists across restart.
- [ ] Change the library folder, then Open PDF on an item saved under the old folder still works.

## Passkeys (needs XPILOT_TEAM_ID + `npm run sign-dev`, see docs/passkeys.md)
- [ ] Startup log shows `passkeys enabled with keychain group …`.
- [ ] Adding a security key/passkey in X settings triggers a Touch ID prompt titled "XPilot".
- [ ] Sign out, sign in with the passkey: Touch ID prompt appears and login completes.

## Conversations and scheduled tasks
- [ ] History (clock icon) lists past conversations newest first; clicking one restores its transcript and continues the same Codex thread.
- [ ] "Every hour, post a one-line Amsterdam weather update" → the agent creates a task (visible in Scheduled tasks with next run); "Run now" starts a run, a task conversation appears in History, and posting goes through the confirm card.
- [ ] Pause/Resume/Delete work; a paused task has no next run.

## Liking and timeline reading
- [ ] "Like the first post" → the post on screen gets liked without navigation; it appears in liked history.
- [ ] "Like <url of a post not on screen>" → liked via the hidden window; the visible window does not move.
- [ ] Settings → Agent likes → Confirm: liking asks first; Cancel is reported as the user's decision.
- [ ] "Every 30 minutes scroll my For You timeline and like all posts by @dhh" → task created; Run now reads the timeline in the hidden window and likes matching posts.

## News, trends and new posts
- [ ] On Home: "what's trending?" → answered from the sidebar widget on screen (source: visible), no navigation.
- [ ] On Home: "what's in Today's News?" → the hidden window loads Explore (source: background); the visible window does not move.
- [ ] Wait for the "Show N posts" pill on Home, then "show me the new posts" → x_show_new_posts clicks it and the timeline refreshes on screen.

## Inspecting the live app
Start with `XPILOT_CDP_PORT=9222 npm run dev`, then `node scripts/inspect.mjs --list` and
`node scripts/inspect.mjs x "document.title"` (targets: x, bg, sidebar, or a URL substring;
`--screenshot file.png` captures the page).
