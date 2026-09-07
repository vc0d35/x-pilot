# X Pilot manual test (real x.com)

Run `npm run dev`, logged into x.com in the X view.

## Navigation
- [ ] Clicking a t.co link in a post opens the target in the system browser; the X view stays on x.com.
- [ ] Google/Apple sign-in popups (if used) open in-app; other popups go external.

## Agent
- [ ] Header reaches `ready`; an error banner appears if `codex login` is needed.
- [ ] "Which page am I on?" → `x_get_page_state` tool row, correct answer.
- [ ] Stop button interrupts a long answer.
- [ ] New thread clears the list; a settings change (model) restarts and resumes the thread.

## Focus context
- [ ] Open a post → chip "Post by @…" appears; "is this true?" is answered about that post.
- [ ] Detach the chip → the agent needs to be told which post.
- [ ] Reply dialog on the timeline → chip shows the post being replied to.

## Reading
- [ ] "Summarise the visible posts" on Home.
- [ ] "Read <post url>" navigates and returns the thread text.
- [ ] Open an X Article; "summarise this article" returns title + body.

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
