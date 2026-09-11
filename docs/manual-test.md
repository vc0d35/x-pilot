# X Pilot manual test (real x.com)

Run `npm run dev`, logged into x.com in the X view.

## Navigation

- [ ] Clicking a t.co link in a post opens the target in the system browser; the X view stays on x.com.
- [ ] Google/Apple sign-in popups (if used) open in-app; other popups go external.

## Agent

- [ ] The header pill names the model in use (e.g. `GPT-5.6-Luna` or `Sonnet 5`) with a breathing dot; clicking it opens Settings. While the agent is starting it reads `connecting…`, and a dead agent shows `disconnected`/`error` with a `reconnect` link next to it.
- [ ] "Which page am I on?" → the right answer; a model that reads it off the page hint without a tool row is fine. Then "how many posts are on my screen?", which the hint cannot answer: that one must show a tool row.
- [ ] Stop button interrupts a long answer.
- [ ] Open a post with a factual claim and ask "is this true?" → a `web_search` tool row appears and the answer cites non-X sources; Settings → Web search → Off makes the agent stop searching the web.
- [ ] Ctrl+D from anywhere (even with the sidebar collapsed) focuses the agent input.
- [ ] Header chevron hides the sidebar entirely (x.com fills the window); View → Toggle Sidebar or ⌘\ brings it back with the conversation intact.
- [ ] New thread clears the list; a settings change (model) restarts and resumes the thread, and the pill follows the new model.
- [ ] Quit and relaunch; ask "which page am I on?" → the agent still calls a tool (thread resumed with tools).

## Collapsed handle

- [ ] Collapse the sidebar (header chevron or ⌘\) → the XPilot pill floats near the top-right over x.com; clicking it brings the sidebar back.
- [ ] Collapse again, then press and hold the pill and move the pointer: it lifts and follows the pointer anywhere over the page, x.com still showing through everywhere but the pill, and nothing on the page gets selected. Let go → it stays where you dropped it.
- [ ] A plain click still expands the sidebar and never moves the pill; a drag never expands it.
- [ ] Press Escape mid-drag → the pill goes straight back to where it was picked up from and nothing is remembered.
- [ ] Expand and collapse again → the pill comes back to the spot you dragged it to, not the top-right corner; quit and start again, collapse, and it is still there.
- [ ] Drag it near an edge, then resize the window smaller than that spot → the pill stays fully inside the window with its margin; widen the window again and it is still inside.
- [ ] Both themes (System Settings → Appearance): the pill reads the same light and dark, dragging or not.

## Focus context

- [ ] Open a post; "is this true?" is answered about that post (the focused post is sent with the turn; no chip is shown).
- [ ] Reply dialog on the timeline → questions refer to the post being replied to.

## Reading

- [ ] "Summarise the visible posts" on Home.
- [ ] "Read <post url>" returns the thread text WITHOUT moving the visible window (it runs in the hidden session window).
- [ ] "Search X for electron and show me" → the visible window navigates to the results (view: visible).
- [ ] "Roll my timeline until you find a post by @dhh" → the visible window scrolls (x_scroll + x_read_visible_posts).
- [ ] Open a post that quotes another post; "what does the quoted post say?" is answered from the quote, and "what did the author themselves write?" from the post's own text.
- [ ] Open a post with a link card; "what is that link?" → the agent knows the URL and the headline without opening it. A post with images: "what is in the picture?" → it reports the alt text, or that there is an image it cannot see.
- [ ] Open a post with a photo; "what is the URL of that image?" → a `https://pbs.twimg.com/media/…` one (from `x_read_current_post`, not from the fenced hint, which still says only `media: image "…"`). A post with a video: the same question gives the poster frame's URL. A post whose picture X serves from anywhere else, or from `http`, gives no URL at all rather than a patched-up one.
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

## Page styles

- [ ] "Make the timeline text bigger" → the visible page changes at once as a preview and a card appears showing the whole stylesheet with Keep / Adjust… / Revert. Revert puts the page back and the agent reports the decision rather than retrying; Adjust… opens a box ("make it bigger still"), and Send takes the preview off and comes back with a new proposal built on the note; Keep leaves the styles on the page and writes the file (Settings → Page styles → Open file shows the CSS).
- [ ] With a card up, "Remove every page style" is asked without a preview (a layered sheet cannot show rules going away), with Keep / Revert only.
- [ ] Navigate the X view while a preview card is up → the preview goes with the old document; answering Keep still writes the file and the styles come back.
- [ ] Settings → Page config → Page styles → Open file shows the CSS and editing it in an editor re-applies on save; Reset puts the page back with no card, and a hidden-window read ("read <post url>") is unaffected either way.
- [ ] Paste `body { background: url(https://example.com/x.png) }` into the file by hand and save → the page does not change and the Page styles row says "Not applied: …". Delete the line and it applies again.
- [ ] Settings → Page styles → Autonomous warns first; after switching, "make the links green" applies with no card.

## Custom views

- [ ] "Build me a view that shows the posts on my timeline as cards" → the agent calls xpilot_view_api first, writes index.html and app.js, and the view appears in place of the X page with a "Keep this view?" card (Keep / Adjust… / Revert). Revert puts x.com back and the agent reports the decision rather than retrying; Adjust… ("bigger cards") takes it off and comes back with a rewrite; Keep leaves it up and the sidebar carries a "Custom view: <name>" banner with "Back to X".
- [ ] While the view is up: scrolling the timeline is impossible with the mouse (the X page is underneath), but the view's own "load more" button (x_scroll) brings new posts in and the list updates within about three seconds without the agent doing anything.
- [ ] Click a post in the view → the X page underneath navigates (openInX), and "Back to X" shows it already on that post.
- [ ] Scroll to a post with a photo, then "show the pictures in the view too" → the view draws the image and the author's avatars, loaded straight from twimg with no network of its own; a post with no picture keeps its row, with nothing missing.
- [ ] Ask the agent to change a colour → the file is rewritten and the view on screen reloads by itself, with no card (only activation is confirmed).
- [ ] Edit `<profile>/views/<name>/app.js` in your own editor and save → the same reload. Settings → Custom views → "Open folder" opens the views folder.
- [ ] Settings → Custom views lists every view folder with its file count, the one on screen marked, and Activate / Back to X / Delete. Press Activate on a view you are not looking at, with Custom views still on "Confirm each view in the sidebar" → it goes on screen straight away with **no** "Keep this view?" card, because you asked for it, and quitting and starting again comes back to it.
- [ ] ⌘⇧X (View → Back to X) puts the X page back from anywhere, and is greyed out while no view is up. The View menu lists one "Activate <name>" per view, the one on screen checked, and a view with no index.html greyed out; ask the agent to write a new view and the menu and the Settings list both gain it without reopening anything.
- [ ] Settings → Custom views → Delete asks "Delete the view “<name>” and every file in it?" first; Cancel leaves the folder alone, OK removes it from the list (and from the View menu). Deleting the view that is on screen puts the X page back first.
- [ ] Put `console.log('hello')` and a deliberate `throw` in the view → "what is the view logging?" (xpilot_view_console) shows both lines, the thrown one as an error with `app.js:<line>:<col>`; "what did the view render?" (xpilot_view_inspect) shows the markup.
- [ ] Ask the agent to "add a deliberate bug to the view that throws on load" → the view reloads, stays on screen and keeps whatever it drew before the throw, and the sidebar raises `Custom view "<name>" failed: <message>` with "Dismiss" and "Fix it". Press "Fix it" → the message appears in the conversation as if you had typed it, and the agent reads the console, repairs the file and activates the view again; the banner is gone and the view works.
- [ ] Break index.html so it cannot load (delete it while the view is up, or point the agent at a view with no index.html) → the app falls back to the X page, the sidebar raises the same banner with "Back to X" and "Fix it" instead, and the view is forgotten: quit and start again and the app is on x.com.
- [ ] Have the view throw in a loop (`setInterval(() => { throw new Error('x') }, 50)`) → one banner, not twenty; after about twenty errors in a minute the view is taken off the screen with "too many errors; deactivated".
- [ ] Ask for a view that fetches something from the internet → the network call fails in the view's console (no network at all), and the agent is expected to use the bridge instead.
- [ ] Ask the agent, from inside a view's code, to call something like xpilot_write_page_styles → refused by the bridge with the allowlist in the error.
- [ ] Quit with the view up and start again → it comes back after x.com has loaded. Delete the view folder by hand and start again → the app starts on x.com and forgets it.
- [ ] "Delete the cards view" → a "Delete this view?" card listing the files; Keep it leaves the folder alone.
- [ ] Settings → Custom views → Autonomous warns first; after switching, "show me the cards view" activates with no card.
- [ ] While the "Keep this view?" card is still up, the view's own buttons that call a driver or a write ("load more", "like this") report `This view is a preview; keep it first`; its list of posts still fills in, because reads and the feeds still work. Keep it, and the same buttons work.
- [ ] With Settings → Agent likes on Autonomous, click a view's own "like" button → a card appears anyway, headed "Requested by the custom view "<name>"" above "Like this post?", framed differently from the agent's cards. Cancel is reported to the view as the user's decision. The same holds for bookmarking, and for posting with Autonomous posting on: a view asks before it opens the composer and again before it posts.
- [ ] Collapse the sidebar (⌘\) so the view owns the whole window, then have the view ask for a like → the sidebar comes back out with the card on it, rather than the request waiting somewhere nobody can see.
- [ ] After any of that, the transcript shows `view:x_like_post` (and `view:x_get_page_state`, `view:x_scroll`, …) as tool rows — open one and it shows the arguments the view sent and the result. They are still there after a restart, in History.
- [ ] Ask for a view whose code calls `openInX('https://t.co/…')` → refused ("may only open https pages on x.com or twitter.com"); `openInX('https://x.com/explore')` works.
- [ ] Have a view compose a post and then click "Back to X" without posting → x.com is on the home timeline, not on a composer with the view's text in it.
- [ ] A view that offers a "download" (an `<a download>` of a blob it built) → nothing is saved and no Save dialog appears.
- [ ] A view drawn with three.js (the second starter from xpilot_view_api) renders: `xpilot://lib/three.module.js` and OrbitControls load, and dragging orbits the scene.
- [ ] "Build me a reader for my timeline where j and k move a highlight, and tell me which post is highlighted" → the view goes up; press j a couple of times and ask "is this true?" → the answer is about the highlighted post, not about whatever the X page underneath has focused, and the transcript shows either no tool row at all (the hint carried it) or an `xpilot_view_state` one.
- [ ] With the same view up, "focus the next post" → the highlight moves in the view without the X page underneath moving, and the transcript shows `xpilot_view_message`. Ask "what is on my screen?" → the summary the view published, not x.com.
- [ ] Take the view off (⌘⇧X) and ask "what post is highlighted?" → the agent says no view is on screen rather than answering from a stale state; activate it again and the answer is right from the first turn.

## Selectors

- [ ] Settings → Page config → Selectors shows the file path and "0 overridden, 0 stale"; "Ask the agent to point the tweetText selector at .nonsense" → xpilot_set_selector reports a match count of 0 with a warning, the count in Settings goes to 1 overridden after the panel is reopened, and a timeline read comes back with empty post text; "Reset all" (or xpilot_reset_selector with all) puts the reads back without a restart.
- [ ] "Ask the agent to point the postButton selector somewhere else" → refused, with the reason that it decides what XPilot clicks; xpilot_list_selectors shows that key as locked.
- [ ] "Show me the markup of the first post" → x_inspect_page returns tags and data-testids, fenced as page content; "how many things match article[data-testid=tweet] right now" → xpilot_test_selector answers with a count and writes nothing.
- [ ] Put `"article": { "selector": "div:has(((", "replacedDefault": "x" }` into selectors.json by hand → reads keep working (the value falls back to the shipped default) rather than every read failing.
- [ ] Truncate selectors.json to half a line and save → the overrides in effect stay in effect, the file is not renamed aside, and the Selectors row says why.
- [ ] Override the `article` selector, then "save <post url> as a PDF" → the export still works, i.e. it used the override.

## Passkeys (needs XPILOT_TEAM_ID + `npm run sign-dev`, see docs/passkeys.md)

- [ ] Startup log shows `passkeys enabled with keychain group …`.
- [ ] Adding a security key/passkey in X settings triggers a Touch ID prompt titled "XPilot".
- [ ] Sign out, sign in with the passkey: Touch ID prompt appears and login completes.

## Conversations and scheduled tasks

- [ ] History (clock icon) lists past conversations newest first; clicking one restores its transcript and continues that thread on the backend that wrote it.
- [ ] "Every hour, post a one-line Amsterdam weather update" → the agent creates a task (visible in Scheduled tasks with next run); "Run now" starts a run, a task conversation appears in History, and posting goes through the confirm card.
- [ ] While a task is running, open its run from History: it is marked "running", the banner says "Viewing a scheduled run", new events appear as the run makes them, and the composer is read-only. "Back to chat" returns to your own conversation with its transcript intact and the composer usable again.
- [ ] "Every 30 minutes, on my screen while I'm away, scroll my timeline and open anything about Electron" → the task is created with visibleWindow and shows a "screen" badge in Scheduled tasks; a task asked for without that phrasing has no badge.
- [ ] "Run now" runs immediately even while you are active — it is you asking for it. A scheduled tick while you are active is what defers: use the app, wait for the task's own next run to come due, and the row says `deferred` with the next run two minutes out; leave the app alone and it runs then, moving the window you are looking at.
- [ ] While it runs, the sidebar shows "A scheduled task is using your window: …" on top of your own conversation, and it is still there on the History and Settings panels. Stop ends the run: the banner goes and the task row says `interrupted`.
- [ ] Pause/Resume/Delete work; a paused task has no next run.

## Liking and timeline reading

- [ ] "Like the first post" → the post on screen gets liked without navigation, and a row for it appears in the liked index (ask "what did I like about <a word from that post>?"): a like the agent made for you is one of yours.
- [ ] "Like <url of a post not on screen>" → liked via the hidden window; the visible window does not move.
- [ ] Settings → Agent likes → Confirm: liking asks first; Cancel is reported as the user's decision.
- [ ] "Every 30 minutes scroll my For You timeline and like all posts by @dhh" → task created; Run now reads the timeline in the hidden window and likes matching posts.
- [ ] Bookmarks: "bookmark this" with a post on screen → the confirm card names the post; accept and its bookmark icon fills. "what did I bookmark about compilers?" → the hidden window reads the bookmarks page; the visible window does not move.

## News, trends and new posts

- [ ] On Home: "what's trending?" → answered from the sidebar widget on screen (source: visible), no navigation.
- [ ] On Home: "what's in Today's News?" → the hidden window loads Explore (source: background); the visible window does not move.
- [ ] Wait for the "Show N posts" pill on Home, then "show me the new posts" → x_show_new_posts clicks it and the timeline refreshes on screen.

## Security

Open DevTools on the X view (`XPILOT_CDP_PORT=9222 npm run dev`, then `node scripts/inspect.mjs x "…"`)
for the first two checks; both must fail to do anything.

- [ ] Synthetic like: run
      `document.querySelector('button[data-testid="like"]').click()` in the X view console → no new row in
      liked history ("what did I like about …?" and Settings → history count are unchanged). Then like the
      same post by hand (mouse, and again with X's `l` shortcut) → the row does appear.
- [ ] Injected post: add an `article[data-testid="tweet"]` with `style="display:none"`, a `@nytimes`
      display name and an `/attacker/status/<id>` permalink to a status page → "what post am I looking at?"
      still reports the real post and author; a scripted click on its like button records nothing.
- [ ] Popup from a popup (fixed in the navigation lane): from an allowed popup, open another window and
      send it off-allowlist → it lands in the system browser, never in an app window without chrome.
- [ ] Long approval detail: ask for something that needs approval with a very long detail (e.g. a command
      with a few hundred blank lines) → the card's title and its Allow/Deny buttons are both visible without
      scrolling; only the detail block scrolls, and the list does not scroll past a pending card.
- [ ] Deceptive link: have the agent write `[https://x.com/safe](https://evil.com/phish)` → the sidebar
      shows `https://x.com/safe (evil.com)`, hovering shows the full href, and clicking opens evil.com in
      the system browser (never in the X view).

## Inspecting the live app

Start with `XPILOT_CDP_PORT=9222 npm run dev`, then `node scripts/inspect.mjs --list` and
`node scripts/inspect.mjs x "document.title"` (targets: x, bg, sidebar, or a URL substring;
`--screenshot file.png` captures the page).

## First run and setup

- [ ] Fresh profile (`XPILOT_USER_DATA=$(mktemp -d) npm run dev`): the "Choose a model to connect" card is the first thing in the conversation, with Codex and Claude, one requirement line each, and no onboarding card yet. The composer is disabled and reads "Choose a model to start", and the pill says `choose a model`.
- [ ] Connect on one of them: the option reads "Connecting…" while the CLI is asked one question, then the card goes, the onboarding card takes its place, the pill shows that model's name, and a message can be sent.
- [ ] Connect on a backend that is not installed or not logged in: the CLI's own error appears under that option with a one-line fix (`codex login` / run `claude` once and log in), and the other option still works.
- [ ] Settings → Models: both rows show a state (`active` / `connected` / `not connected`); Check on the active one answers, Use on the other switches to it, the pill changes, and the conversation starts fresh on the new backend. Only the active backend's model, effort, web search (and Codex approvals) rows are shown.
- [ ] With Claude active, open a Codex conversation from History: the row carries a `Codex` badge, the banner says the conversation was with Codex and offers Settings, the transcript is readable and the composer is disabled. Back to chat (the conversation icon) returns to your own thread.
- [ ] Settings → Models → the active backend's binary → a bogus path, then reconnect: the setup card names that backend, with its install and login commands and a Try again button; clearing the path and Try again removes the card.
- [ ] `codex logout` in a terminal, then send a message: the card says you are logged out and shows `codex login`; log in, Try again, card disappears.
- [ ] Packaged build (`npm run dist`, open `dist/mac-arm64/XPilot.app`) from Finder: Codex is found without a terminal PATH.
- [ ] Collapse the sidebar and drag the window narrower than 1000 px: it goes down to 640. Expand: the window grows back to 1000 first, staying on screen.
