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

type Harness = {
  windowCount(): number;
  sidebar: { webContents: { executeJavaScript(c: string): Promise<unknown> } };
  registry: {
    list(): { name: string }[];
    call(n: string, a: object, o?: { allowInternal?: boolean }): Promise<{ success: boolean; content?: unknown; error?: string }>;
  };
  openExternalCalls: string[];
  xView: { webContents: { executeJavaScript(c: string): Promise<unknown> } };
  styles: { set(css: string): { ok: boolean }; reset(): void };
  selectors: { set(key: string, selector: string): { ok: boolean }; resetAll(): void };
};
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
  // The internal tool xpilot_set_selector checks a selector with, run in the view the user is looking at.
  expect(await inMain((t) => t.registry.call('x_test_selector', { selector: '#pill' }, { allowInternal: true }))).toMatchObject({
    success: true,
    content: { valid: true, count: 1 },
  });
  expect(await pillCount()).toBeNull();
  expect(await inMain((t) => t.selectors.set('newPostsButton', '#pill'))).toMatchObject({ ok: true });
  await expect.poll(pillCount, { timeout: 15_000 }).toBe(3);
  await inMain((t) => t.selectors.resetAll());
  await expect.poll(pillCount, { timeout: 15_000 }).toBeNull();
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

test('both preloads are self-contained bundles and the React header renders', async () => {
  for (const name of ['sidebar', 'x']) {
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
