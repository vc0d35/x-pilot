import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let app: ElectronApplication;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [resolve('out/main/index.js')],
    env: {
      ...process.env,
      XPILOT_E2E: '1',
      XPILOT_START_URL: pathToFileURL(resolve('tests/fixtures/local-page.html')).href,
      XPILOT_USER_DATA: mkdtempSync(join(tmpdir(), 'xpilot-e2e-')),
    },
  });
  // electron.launch() resolves once the app is ready, slightly before main's
  // whenReady().then() callback has run far enough to set __xpilotTest. Wait
  // for it here (swallowing the pre-ready rejection) so the tests below never
  // race main's startup.
  await expect
    .poll(
      async () => {
        try {
          return await app.evaluate(() => !!(globalThis as { __xpilotTest?: unknown }).__xpilotTest);
        } catch {
          return false;
        }
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});
test.afterAll(async () => {
  await app.close();
});

type Bounds = { x: number; y: number; width: number; height: number };
type Harness = {
  windowCount(): number;
  sidebar: { webContents: { executeJavaScript(c: string): Promise<unknown> }; getBounds(): Bounds };
  win: { getContentBounds(): Bounds };
  registry: {
    list(): { name: string }[];
    call(n: string, a: object, o?: { allowInternal?: boolean }): Promise<{ success: boolean; content?: unknown; error?: string }>;
  };
  openExternalCalls: string[];
  xView: { webContents: { executeJavaScript(c: string): Promise<unknown> } };
  styles: { set(css: string): { ok: boolean }; reset(): void };
  selectors: { set(key: string, selector: string): { ok: boolean }; resetAll(): void };
  settings: {
    update(patch: object): unknown;
    get(): { views: { active: string | null }; window: { handle: { x: number; y: number } | null } };
  };
  views: { dir: string; write(view: string, path: string, content: string): { bytes: number }; delete(view: string): boolean };
  agent: { onEvent(cb: (e: { type: string; name?: string }) => void): () => void };
  viewCanvas: {
    active(): string | null;
    contents(): { executeJavaScript(c: string): Promise<unknown>; getURL(): string } | null;
    logs: { get(view?: string, limit?: number): { text: string }[] };
  };
  /** What Settings and the View menu call: the same functions, with no card in front of them. */
  viewSwitcher: {
    list(): { name: string; files: number; hasIndex: boolean; active: boolean }[];
    activate(name: string): Promise<unknown>;
    deactivate(): unknown;
    remove(name: string): unknown;
  };
  approvals: {
    onEvent(
      cb: (e: {
        type: string;
        request?: {
          id: string;
          title: string;
          detail: string;
          origin: { kind: string; name?: string };
          options: { id: string; label: string }[];
        };
      }) => void,
    ): () => void;
    resolve(id: string, decision: string): boolean;
  };
};
/** Runs a snippet in the sidebar renderer, i.e. as the sender main's guarded IPC handlers accept. */
const inSidebar = (script: string) =>
  app.evaluate(async (_electron, js: string) => {
    const t = (globalThis as { __xpilotTest?: Harness }).__xpilotTest!;
    return t.sidebar.webContents.executeJavaScript(js);
  }, script);
const inMain = <T>(fn: (t: Harness) => T | Promise<T>) =>
  app.evaluate(async (_electron, fnSrc: string) => {
    const t = (globalThis as { __xpilotTest?: Harness }).__xpilotTest!;
    return new Function('t', `return (${fnSrc})(t)`)(t);
  }, fn.toString());

test('the preload registers its adapter tools with the main-process registry', async () => {
  await expect
    .poll(() => inMain((t) => t.registry.list().map((x) => x.name)), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(['x_get_page_state', 'x_read_visible_posts']));
});

test('x_get_page_state works on a non-x.com page', async () => {
  const r = await inMain((t) => t.registry.call('x_get_page_state', {}));
  expect(r).toMatchObject({ success: true, content: { kind: 'other', adapterHealthy: true, title: 'fixture ready' } });
});

// Before the external-link test: the click there starts a main-frame navigation the policy then
// cancels, which leaves the bridge waiting for a registration the page never sends again.
test('a selector override reaches the X view and changes what the adapter reads', async () => {
  // The fixture's pill is not the markup X ships, so no shipped selector finds it: the only way
  // x_get_page_state can report it is if the override reached the preload's SEL object.
  const pillCount = () =>
    inMain(async (t) => {
      const r = await t.registry.call('x_get_page_state', { timeoutMs: 0 });
      return r.success ? ((r.content as { newPostsAvailable?: number }).newPostsAvailable ?? null) : r.error;
    });
  // x_test_selector is the internal probe xpilot_set_selector runs before it writes anything; it
  // executes in the view the user is looking at.
  expect(await inMain((t) => t.registry.call('x_test_selector', { selector: '#pill' }, { allowInternal: true }))).toMatchObject({
    success: true,
    content: { valid: true, count: 1 },
  });
  // The model-facing pair the repair story runs on: look at the markup, then measure a candidate.
  expect(await inMain((t) => t.registry.call('x_inspect_page', { selector: '#pill', limit: 1 }))).toMatchObject({
    success: true,
    content: { matches: 1, elements: [{ tag: 'button' }] },
  });
  expect(await inMain((t) => t.registry.call('xpilot_test_selector', { selector: '#pill' }))).toMatchObject({
    success: true,
    content: { valid: true, count: 1 },
  });
  expect(await pillCount()).toBeNull();
  expect(await inMain((t) => t.selectors.set('newPostsButton', '#pill'))).toMatchObject({ ok: true });
  await expect.poll(pillCount, { timeout: 15_000 }).toBe(3);
  await inMain((t) => t.selectors.resetAll());
  await expect.poll(pillCount, { timeout: 15_000 }).toBeNull();
});

test('a selector that drives an action cannot be moved by a tool', async () => {
  // The composer read and the Post click both go through these, so a tool that could redirect one
  // would turn an approved post into a different one. Only the user's own file may.
  const before = await inMain((t) => t.registry.call('x_test_selector', { selector: '#danger' }, { allowInternal: true }));
  expect(before).toMatchObject({ success: true });
  expect(await inMain((t) => t.registry.call('xpilot_set_selector', { key: 'postButton', selector: '#danger' }))).toMatchObject({
    success: false,
    error: expect.stringContaining('cannot be changed from a tool'),
  });
  const listed = (await inMain((t) => t.registry.call('xpilot_list_selectors', {}))) as {
    content: { selectors: { key: string; effective: string; locked: boolean }[] };
  };
  const postButton = listed.content.selectors.find((i) => i.key === 'postButton')!;
  expect(postButton).toMatchObject({ locked: true, effective: '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]' });
});

test('a stylesheet the tool writes is previewed on the page, and reverting leaves the file alone', async () => {
  const styles = () => inMain((t) => t.registry.call('xpilot_read_page_styles', {}));
  const colour = () => inMain((t) => t.xView.webContents.executeJavaScript("getComputedStyle(document.getElementById('ext')).color"));
  const before = (await styles()) as { content: { css: string } };
  const plain = await colour();
  type Pending = { __pendingStyles?: Promise<unknown>; __pendingStylesId?: string };
  const asked = await inMain(async (t) => {
    t.settings.update({ styles: { mode: 'confirm' } });
    // The card is raised synchronously inside the tool call, so the listener goes on first.
    const seen: { id: string; title: string; detail: string; options: { id: string; label: string }[] }[] = [];
    const off = t.approvals.onEvent((e: { type: string; request?: (typeof seen)[number] }) => {
      if (e.type === 'approval.requested' && e.request) seen.push(e.request);
    });
    // Left pending on purpose: the preview is on the page for exactly as long as the card is up.
    (globalThis as Pending).__pendingStyles = t.registry.call('xpilot_write_page_styles', { css: '#ext { color: rgb(9, 9, 9) }' });
    off();
    (globalThis as Pending).__pendingStylesId = seen[0]?.id;
    return seen;
  });
  expect(asked).toEqual([
    expect.objectContaining({
      title: 'Keep these page styles?',
      detail: '#ext { color: rgb(9, 9, 9) }',
      options: [
        { id: 'keep', label: 'Keep' },
        { id: 'adjust', label: 'Adjust…', note: true },
        { id: 'revert', label: 'Revert' },
      ],
    }),
  ]);
  await expect.poll(colour, { timeout: 15_000 }).toBe('rgb(9, 9, 9)');
  const result = await inMain(async (t) => {
    t.approvals.resolve((globalThis as Pending).__pendingStylesId!, 'revert');
    return (globalThis as Pending).__pendingStyles;
  });
  expect(result).toMatchObject({ success: true, content: { status: 'cancelled_by_user' } });
  await expect.poll(colour, { timeout: 15_000 }).toBe(plain);
  expect(((await styles()) as { content: { css: string } }).content.css).toBe(before.content.css);
  await inMain((t) => t.settings.update({ styles: { mode: 'autonomous' } }));
});

/**
 * A custom view end to end: written to the profile, shown over X on its own session, talking to the
 * app through the bridge and nothing else. The X view stays loaded underneath, which is what makes
 * the reads a view asks for work at all.
 */

/** Runs JavaScript inside the canvas. The source travels as an argument: `inMain` sends a function's
 * text, so nothing it closes over exists on the other side. */
const inCanvas = (js: string) =>
  app.evaluate(async (_electron, src: string) => {
    const t = (globalThis as { __xpilotTest?: Harness }).__xpilotTest!;
    return t.viewCanvas.contents()!.executeJavaScript(src);
  }, js);

const VIEW_INDEX = [
  '<!doctype html><meta charset="utf-8" /><title>e2e view</title>',
  '<div id="out">waiting</div>',
  // No inline script: the view CSP has no 'unsafe-inline', which is what the starters are shaped for.
  '<script type="module" src="app.js"></script>',
].join('\n');

const VIEW_APP = [
  'window.__seen = [];',
  "window.xpilotView.subscribe('page', (ctx) => window.__seen.push(ctx === null ? 'null' : 'context'));",
  "document.getElementById('out').textContent = 'rendered';",
  // A blob worker is the one place a view could still hold a global the preload never reached, so
  // it is asked as well: WebRTC is what CSP does not cover, and it is the whole no-network claim.
  'window.__inWorker = (expression) =>',
  '  new Promise((resolve) => {',
  "    const source = 'self.postMessage(' + expression + ')';",
  "    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));",
  '    worker.onmessage = (e) => resolve(e.data);',
  "    worker.onerror = () => resolve('worker error');",
  "    setTimeout(() => resolve('worker timeout'), 5000);",
  '  });',
  'window.__probe = async () => ({',
  "  read: await window.xpilotView.call('x_get_page_state', { timeoutMs: 0 }),",
  "  refused: await window.xpilotView.call('xpilot_write_page_styles', { css: 'body{}' }),",
  "  network: await fetch('https://example.com/').then(() => 'allowed', (e) => 'blocked: ' + e.name),",
  '  sidebarApi: typeof window.xpilot,',
  '  webrtc: typeof RTCPeerConnection,',
  '  webrtcData: typeof RTCDataChannel,',
  '  media: typeof navigator.mediaDevices,',
  "  webrtcInWorker: await window.__inWorker('typeof RTCPeerConnection'),",
  '});',
].join('\n');

test('a custom view renders over X, reaches the bridge, and goes away again', async () => {
  await app.evaluate(
    async (_electron, files: { index: string; app: string }) => {
      const t = (globalThis as { __xpilotTest?: Harness }).__xpilotTest!;
      t.settings.update({ views: { mode: 'autonomous' } });
      t.views.write('e2e', 'index.html', files.index);
      t.views.write('e2e', 'app.js', files.app);
    },
    { index: VIEW_INDEX, app: VIEW_APP },
  );
  const activated = await inMain((t) => t.registry.call('xpilot_activate_view', { view: 'e2e' }));
  expect(activated.error ?? null).toBeNull();
  expect(activated).toMatchObject({ success: true, content: { status: 'kept', view: 'e2e' } });
  expect(await inMain((t) => t.viewCanvas.active())).toBe('e2e');
  expect(await inMain((t) => t.viewCanvas.contents()!.getURL())).toBe('xpilot://views/e2e/index.html');
  await expect.poll(() => inCanvas("document.getElementById('out').textContent"), { timeout: 15_000 }).toBe('rendered');
  expect(await inCanvas('typeof window.xpilotView')).toBe('object');
  // The page feed reaches the view; the fixture has no posts, so the context itself is null.
  await expect.poll(() => inCanvas('window.__seen.length'), { timeout: 15_000 }).toBeGreaterThan(0);
  const probe = (await inCanvas('window.__probe()')) as {
    read: { success: boolean; content: { title: string } };
    refused: { success: boolean; error: string };
    network: string;
    sidebarApi: string;
    webrtc: string;
    webrtcData: string;
    media: string;
    webrtcInWorker: string;
  };
  // An allowlisted read runs against the X page underneath, which is still loaded.
  expect(probe.read).toMatchObject({ success: true, content: { title: 'fixture ready' } });
  expect(probe.refused).toMatchObject({ success: false, error: expect.stringContaining('may not call xpilot_write_page_styles') });
  expect(probe.network).toMatch(/^blocked/);
  expect(probe.sidebarApi).toBe('undefined');
  // WebRTC reaches an arbitrary host:port and no content policy governs it: the preload takes the
  // constructors away before any view script runs, and a worker never had them.
  expect(probe.webrtc).toBe('undefined');
  expect(probe.webrtcData).toBe('undefined');
  expect(probe.media).toBe('undefined');
  expect(probe.webrtcInWorker).toBe('undefined');
  expect(await inCanvas("(() => { try { new RTCPeerConnection(); return 'constructed'; } catch (e) { return e.name; } })()")).toBe(
    'TypeError',
  );
  expect(await inMain((t) => t.registry.call('xpilot_view_inspect', { selector: '#out', limit: 1 }))).toMatchObject({
    success: true,
    content: { matches: 1, elements: [{ tag: 'div' }] },
  });
  expect(await inMain((t) => t.registry.call('xpilot_deactivate_view', {}))).toMatchObject({
    success: true,
    content: { status: 'deactivated', wasShowing: 'e2e' },
  });
  expect(await inMain((t) => t.viewCanvas.active())).toBeNull();
  await inMain((t) => t.views.delete('e2e'));
});

/**
 * What a kept view may do to the account, and what the user is shown while it does it. A view is
 * agent-written code with no turn around it, so its calls are rows in the transcript and its cards
 * say whose they are — and the autonomous settings, which the user gave the agent, do not apply.
 */
const WRITER_APP = [
  "window.__like = () => window.xpilotView.call('x_like_post', { url: 'https://x.com/alice/status/1' });",
  "window.__navigate = (url) => window.xpilotView.call('x_navigate', { url });",
  "window.__read = () => window.xpilotView.call('x_get_page_state', { timeoutMs: 0 });",
  "document.getElementById('out').textContent = 'rendered';",
].join('\n');

/** The cards main raised, and the events a view's calls put on the agent's stream. */
type Card = { id: string; title: string; origin: { kind: string; name?: string } };
type Traced = { type: string; name?: string; args?: unknown; success?: boolean; output?: string };
const cards = () => inMain((_t) => (globalThis as { __cards?: Card[] }).__cards ?? []);
const traced = () => inMain((_t) => (globalThis as { __traced?: Traced[] }).__traced ?? []);

test('a view-originated like asks the user even in autonomous mode, and leaves a transcript row', async () => {
  await app.evaluate(
    async (_electron, files: { index: string; app: string }) => {
      const t = (globalThis as { __xpilotTest?: Harness }).__xpilotTest!;
      const collected: Card[] = [];
      (globalThis as { __cards?: Card[] }).__cards = collected;
      t.approvals.onEvent((e) => {
        if (e.type === 'approval.requested' && e.request) collected.push(e.request);
      });
      const events: Traced[] = [];
      (globalThis as { __traced?: Traced[] }).__traced = events;
      t.agent.onEvent((e: Traced) => {
        if (e.name?.startsWith('view:')) events.push(e);
      });
      // Both autonomous: what the user granted the agent, which a view does not inherit.
      t.settings.update({ views: { mode: 'autonomous' }, likes: { mode: 'auto' } });
      t.views.write('writer', 'index.html', files.index);
      t.views.write('writer', 'app.js', files.app);
      return t.registry.call('xpilot_activate_view', { view: 'writer' });
    },
    { index: VIEW_INDEX, app: WRITER_APP },
  );
  await expect.poll(() => inCanvas("document.getElementById('out').textContent"), { timeout: 15_000 }).toBe('rendered');
  // Started, not awaited: the call stays on the card until it is answered, and an evaluate that
  // waits for it would block every later one.
  expect(await inCanvas("(window.__like(), 'started')")).toBe('started');
  await expect.poll(cards, { timeout: 15_000 }).toHaveLength(1);
  const card = (await cards())[0];
  expect(card.title).toBe('Like this post?');
  expect(card.origin).toEqual({ kind: 'view', name: 'writer' });
  expect(await inMain((t) => t.approvals.resolve((globalThis as { __cards?: Card[] }).__cards![0].id, 'cancel'))).toBe(true);
  // The call is on the agent's own event stream, as the pair the model's calls produce, under a
  // name that cannot be mistaken for one of the agent's.
  await expect.poll(traced, { timeout: 15_000 }).toHaveLength(2);
  expect(await traced()).toMatchObject([
    { type: 'tool.started', name: 'view:x_like_post', args: { url: 'https://x.com/alice/status/1' } },
    { type: 'tool.completed', name: 'view:x_like_post', success: true, output: expect.stringContaining('cancelled_by_user') },
  ]);
  // And it is a row in the sidebar, where the user can scroll back through it.
  await expect
    .poll(() => inMain((t) => t.sidebar.webContents.executeJavaScript('document.body.innerText')), { timeout: 15_000 })
    .toContain('view:x_like_post');
  await inMain((t) => t.registry.call('xpilot_deactivate_view', {}));
  await inMain((t) => t.views.delete('writer'));
});

test('a view that is only previewed may read and draw, and nothing else', async () => {
  await app.evaluate(
    async (_electron, files: { index: string; app: string }) => {
      const t = (globalThis as { __xpilotTest?: Harness }).__xpilotTest!;
      // The collector installed by the test above, emptied in place: replacing the array would
      // leave the listener pushing into one nobody reads.
      (globalThis as { __cards?: Card[] }).__cards!.length = 0;
      t.settings.update({ views: { mode: 'confirm' } });
      t.views.write('preview-check', 'index.html', files.index);
      t.views.write('preview-check', 'app.js', files.app);
      // Not awaited: in confirm mode the tool stays on the card until the user answers it.
      (globalThis as { __activating?: Promise<unknown> }).__activating = t.registry.call('xpilot_activate_view', {
        view: 'preview-check',
      });
    },
    { index: VIEW_INDEX, app: WRITER_APP },
  );
  await expect.poll(() => inMain((t) => t.viewCanvas.active()), { timeout: 15_000 }).toBe('preview-check');
  await expect.poll(() => inCanvas("document.getElementById('out').textContent"), { timeout: 15_000 }).toBe('rendered');
  expect(await inCanvas('window.__read()')).toMatchObject({ success: true });
  expect(await inCanvas('window.__like()')).toEqual({ success: false, error: 'This view is a preview; keep it first' });
  expect(await inCanvas("window.__navigate('https://x.com/home')")).toEqual({
    success: false,
    error: 'This view is a preview; keep it first',
  });
  // Nothing reached a write tool, so no card was raised by the preview itself.
  expect((await cards()).filter((c: Card) => c.title !== 'Keep this view?')).toEqual([]);
  await inMain((t) => t.approvals.resolve((globalThis as { __cards?: Card[] }).__cards![0].id, 'revert'));
  await expect.poll(() => inMain((t) => t.viewCanvas.active()), { timeout: 15_000 }).toBeNull();
  await inMain((t) => t.settings.update({ views: { mode: 'autonomous' } }));
  await inMain((t) => t.views.delete('preview-check'));
});

test('the library shelf serves three.js to a view, and nothing else', async () => {
  await inMain(async (t) => {
    t.settings.update({ views: { mode: 'autonomous' } });
    t.views.write('lib-check', 'index.html', '<!doctype html><meta charset="utf-8" /><title>lib</title><div id="out"></div>');
    return t.registry.call('xpilot_activate_view', { view: 'lib-check' });
  });
  expect(await inCanvas("import('xpilot://lib/three.module.js').then((m) => typeof m.Scene, (e) => 'failed: ' + e.message)")).toBe(
    'function',
  );
  expect(await inCanvas("import('xpilot://lib/OrbitControls.js').then((m) => typeof m.OrbitControls, (e) => 'failed: ' + e.message)")).toBe(
    'function',
  );
  expect(await inCanvas("import('xpilot://lib/../package.json').then(() => 'loaded', () => 'blocked')")).toBe('blocked');
  await inMain((t) => t.registry.call('xpilot_deactivate_view', {}));
  await inMain((t) => t.views.delete('lib-check'));
});

/**
 * What a view that goes wrong does to the user's screen. A view is code a model wrote out of what a
 * page said, so the two answers that matter are: an error while it renders leaves it up and says so,
 * and a view that cannot be loaded at all puts the X page back and is forgotten.
 */
const BROKEN_APP = [
  "document.getElementById('out').textContent = 'rendered';",
  // A starter that throws on load: the module runs, draws, and then dies where a typo would.
  "throw new TypeError('deliberate boom: posts.map is not a function');",
].join('\n');

const sidebarText = () => inMain((t) => t.sidebar.webContents.executeJavaScript('document.body.innerText'));

test('a view whose script throws keeps rendering, and the sidebar says what threw', async () => {
  await app.evaluate(
    async (_electron, files: { index: string; app: string }) => {
      const t = (globalThis as { __xpilotTest?: Harness }).__xpilotTest!;
      t.settings.update({ views: { mode: 'autonomous' } });
      t.views.write('boom', 'index.html', files.index);
      t.views.write('boom', 'app.js', files.app);
    },
    { index: VIEW_INDEX, app: BROKEN_APP },
  );
  expect(await inMain((t) => t.registry.call('xpilot_activate_view', { view: 'boom' }))).toMatchObject({
    success: true,
    content: { status: 'kept' },
  });
  // The banner is the whole point: it reached the sidebar, over a view that is still on screen.
  await expect.poll(sidebarText, { timeout: 15_000 }).toContain('Custom view “boom” failed');
  expect(await sidebarText()).toContain('deliberate boom');
  expect(await inMain((t) => t.viewCanvas.active())).toBe('boom');
  await expect.poll(() => inCanvas("document.getElementById('out').textContent"), { timeout: 15_000 }).toBe('rendered');
  // And the agent can read it back, with where in the view's own file it happened.
  const logged = (await inMain((t) => t.registry.call('xpilot_view_console', { view: 'boom' }))) as {
    content: { entries: { source: string; text: string; where?: string }[] };
  };
  const thrown = logged.content.entries.find((e) => e.source === 'error');
  expect(thrown!.text).toContain('deliberate boom');
  expect(thrown!.where).toContain('xpilot://views/boom/app.js');
  await inMain((t) => t.registry.call('xpilot_deactivate_view', {}));
  await inMain((t) => t.views.delete('boom'));
});

test('a view with no index.html falls back to X, and is not remembered for the next start', async () => {
  await inMain((t) => {
    t.views.write('gone', 'app.js', "console.log('nothing loads this');");
    // As if the user had kept this view and its entry point had been deleted since.
    t.settings.update({ views: { active: 'gone' } });
  });
  expect(await inMain((t) => t.registry.call('xpilot_activate_view', { view: 'gone' }))).toMatchObject({
    success: false,
    error: expect.stringContaining('no index.html'),
  });
  expect(await inMain((t) => t.viewCanvas.active())).toBeNull();
  await expect.poll(() => inMain((t) => t.settings.get().views.active), { timeout: 15_000 }).toBeNull();
  await expect.poll(sidebarText, { timeout: 15_000 }).toContain('Custom view “gone” failed');
  await inMain((t) => t.views.delete('gone'));
});

/**
 * The user's own path onto a view: Settings and the View menu go through the switcher, not through
 * the agent's tool, so a view goes on screen with no card even while views are set to confirm.
 */
test('activating from Settings shows the view with no card, and Back to X clears what is remembered', async () => {
  await app.evaluate(
    async (_electron, files: { index: string; app: string }) => {
      const t = (globalThis as { __xpilotTest?: Harness }).__xpilotTest!;
      (globalThis as { __cards?: Card[] }).__cards!.length = 0;
      // Confirm mode is what the agent's own activation would raise a card under.
      t.settings.update({ views: { mode: 'confirm' } });
      t.views.write('switch-me', 'index.html', files.index);
      t.views.write('switch-me', 'app.js', files.app);
      return t.viewSwitcher.activate('switch-me');
    },
    { index: VIEW_INDEX, app: WRITER_APP },
  );
  expect(await inMain((t) => t.viewCanvas.active())).toBe('switch-me');
  await expect.poll(() => inCanvas("document.getElementById('out').textContent"), { timeout: 15_000 }).toBe('rendered');
  expect(await inMain((t) => t.settings.get().views.active)).toBe('switch-me');
  expect(await cards()).toEqual([]);
  expect(await inMain((t) => t.viewSwitcher.list())).toContainEqual({ name: 'switch-me', files: 2, hasIndex: true, active: true });
  await inMain((t) => t.viewSwitcher.deactivate());
  expect(await inMain((t) => t.viewCanvas.active())).toBeNull();
  await expect.poll(() => inMain((t) => t.settings.get().views.active), { timeout: 15_000 }).toBeNull();
  await inMain((t) => t.viewSwitcher.remove('switch-me'));
  expect(await inMain((t) => t.viewSwitcher.list().map((v) => v.name))).not.toContain('switch-me');
  await inMain((t) => t.settings.update({ views: { mode: 'autonomous' } }));
});

test('external links are routed to the system browser', async () => {
  await inMain((t) => t.xView.webContents.executeJavaScript("document.getElementById('ext').click()"));
  await expect.poll(() => inMain((t) => t.openExternalCalls)).toContain('https://example.com/outside');
});

test('page styles reach the visible view and are taken back off', async () => {
  const colour = () => inMain((t) => t.xView.webContents.executeJavaScript("getComputedStyle(document.getElementById('ext')).color"));
  const before = await colour();
  expect(await inMain((t) => t.styles.set('#ext { color: rgb(1, 2, 3) }'))).toMatchObject({ ok: true });
  await expect.poll(colour, { timeout: 15_000 }).toBe('rgb(1, 2, 3)');
  await inMain((t) => t.styles.reset());
  await expect.poll(colour, { timeout: 15_000 }).toBe(before);
});

test('every preload is a self-contained bundle and the React header renders', async () => {
  for (const name of ['sidebar', 'x', 'view']) {
    const built = readFileSync(resolve(`out/preload/${name}.js`), 'utf8');
    // A sandboxed preload can require() only electron and node builtins.
    expect(built, name).not.toMatch(/require\("\.\//);
    expect(built, name).not.toMatch(/require\("zod"\)/);
  }
  await expect
    .poll(() => inMain((t) => t.sidebar.webContents.executeJavaScript('typeof window.xpilot')), { timeout: 15_000 })
    .toBe('object');
  await expect
    .poll(() => inMain((t) => t.sidebar.webContents.executeJavaScript("document.querySelector('.brand')?.textContent ?? null")), {
      timeout: 15_000,
    })
    .toBe('XPilot');
  // A fresh profile has no backend chosen, so the first thing the conversation shows is the picker.
  await expect
    .poll(() => inMain((t) => t.sidebar.webContents.executeJavaScript("document.querySelector('.setup-title')?.textContent ?? null")), {
      timeout: 15_000,
    })
    .toBe('Choose a model to connect');
  expect(
    await inMain((t) =>
      t.sidebar.webContents.executeJavaScript("[...document.querySelectorAll('.picker-name')].map((e) => e.textContent)"),
    ),
  ).toEqual(['Codex', 'Claude']);
});

test('the sidebar is served from the app scheme, with its stylesheet and fonts past the CSP', async () => {
  expect(await inMain((t) => t.sidebar.webContents.executeJavaScript('location.href'))).toBe('xpilot://sidebar/index.html');
  expect(await inMain((t) => t.sidebar.webContents.executeJavaScript('location.origin'))).toBe('xpilot://sidebar');
  // The bundle, the stylesheet and a @font-face file all come back through the handler: a CSP that
  // did not recognise the new origin as 'self', or a handler that refused a path, shows up here.
  expect(
    await inMain((t) =>
      t.sidebar.webContents.executeJavaScript(
        "[...document.styleSheets].some((s) => s.href?.startsWith('xpilot://sidebar/assets/') && s.cssRules.length > 0)",
      ),
    ),
  ).toBe(true);
  await expect
    .poll(
      () =>
        inMain((t) =>
          t.sidebar.webContents.executeJavaScript(
            "document.fonts.ready.then(() => [...document.fonts].some((f) => f.status === 'loaded'))",
          ),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  // Containment: the handler serves the renderer directory and nothing above it.
  expect(
    await inMain((t) =>
      t.sidebar.webContents.executeJavaScript("fetch('xpilot://sidebar/../../package.json').then((r) => r.status).catch(() => 'blocked')"),
    ),
  ).not.toBe(200);
});

test('the collapsed handle is dragged to a new spot, and every later collapse lands there', async () => {
  const bounds = () => inMain((t) => t.sidebar.getBounds());
  const collapsed = (c: boolean) => inSidebar(`window.xpilot.setSidebarCollapsed(${c ? 'true' : 'false'})`);
  const drag = (call: string) => inSidebar(`window.xpilot.${call}`);
  await expect.poll(() => inSidebar('typeof window.xpilot'), { timeout: 15_000 }).toBe('object');

  await collapsed(true);
  const handle = await bounds();
  expect(handle).toMatchObject({ width: 104, height: 32 });

  // Picked up 20/16 into the pill: the view becomes the whole window so the pointer cannot leave it.
  await drag('startHandleDrag(20, 16)');
  const content = await inMain((t) => t.win.getContentBounds());
  expect(await bounds()).toEqual({ x: 0, y: 0, width: content.width, height: content.height });

  await drag('moveHandleDrag(400, 300)');
  await drag('endHandleDrag(520, 416)');
  expect(await bounds()).toEqual({ x: 500, y: 400, width: 104, height: 32 });
  expect(await inMain((t) => t.settings.get().window.handle)).toEqual({ x: 500, y: 400 });

  // The spot is the handle's, not the sidebar's: expanded it is the full sidebar again, and the
  // next collapse puts the pill back where the user left it rather than in the default corner.
  await collapsed(false);
  expect((await bounds()).width).toBe(420);
  await collapsed(true);
  expect(await bounds()).toEqual({ x: 500, y: 400, width: 104, height: 32 });

  // A drag that is let go where it started leaves it there; Escape puts it back where it was.
  await drag('startHandleDrag(10, 10)');
  await drag('cancelHandleDrag()');
  expect(await bounds()).toEqual({ x: 500, y: 400, width: 104, height: 32 });

  await collapsed(false);
  await inMain((t) => t.settings.update({ window: { handle: null } }));
  expect(await bounds()).not.toMatchObject({ width: 104 });
});

// Network-dependent (set XPILOT_E2E_NETWORK=1 to run): loads x.com search (logged out) in the hidden session window.
test('x_search runs in the hidden background window without moving the visible view', async () => {
  test.skip(!process.env.XPILOT_E2E_NETWORK, 'needs network');
  const before = await inMain((t) => t.xView.webContents.executeJavaScript('location.href'));
  const r = await inMain((t) => t.registry.call('x_search', { query: 'electron' }));
  expect(r.success).toBe(true);
  expect(Array.isArray(r.content)).toBe(true);
  const after = await inMain((t) => t.xView.webContents.executeJavaScript('location.href'));
  expect(after).toBe(before);
});

// Network-dependent (set XPILOT_E2E_NETWORK=1 to run): resolving the (dead) t.co link makes one HEAD request.
test('a t.co popup opens no window and is routed without touching the visible view', async () => {
  test.skip(!process.env.XPILOT_E2E_NETWORK, 'needs network');
  const beforeWindows = await inMain((t) => t.windowCount());
  const beforeUrl = await inMain((t) => t.xView.webContents.executeJavaScript('location.href'));
  await inMain((t) => t.xView.webContents.executeJavaScript("window.open('https://t.co/xpilot-does-not-exist', '_blank')"));
  await expect.poll(() => inMain((t) => t.openExternalCalls.at(-1)), { timeout: 15_000 }).toBe('https://t.co/xpilot-does-not-exist');
  expect(await inMain((t) => t.windowCount())).toBe(beforeWindows);
  expect(await inMain((t) => t.xView.webContents.executeJavaScript('location.href'))).toBe(beforeUrl);
});
