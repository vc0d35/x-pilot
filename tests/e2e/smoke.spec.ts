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
  await expect.poll(async () => {
    try { return await app.evaluate(() => !!(globalThis as { __xpilotTest?: unknown }).__xpilotTest); } catch { return false; }
  }, { timeout: 15_000 }).toBe(true);
});
test.afterAll(async () => { await app.close(); });

type Harness = { windowCount(): number; sidebar: { webContents: { executeJavaScript(c: string): Promise<unknown> } }; registry: { list(): { name: string }[]; call(n: string, a: object): Promise<{ success: boolean; content?: unknown; error?: string }> }; openExternalCalls: string[]; xView: { webContents: { executeJavaScript(c: string): Promise<unknown> } } };
const inMain = <T,>(fn: (t: Harness) => T | Promise<T>) => app.evaluate(async (_electron, fnSrc: string) => {
  const t = (globalThis as { __xpilotTest?: Harness }).__xpilotTest!;
  return (new Function('t', `return (${fnSrc})(t)`))(t);
}, fn.toString());

test('the preload registers its adapter tools with the main-process registry', async () => {
  await expect.poll(() => inMain((t) => t.registry.list().map((x) => x.name)), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(['x_get_page_state', 'x_read_visible_posts']));
});

test('x_get_page_state works on a non-x.com page', async () => {
  const r = await inMain((t) => t.registry.call('x_get_page_state', {}));
  expect(r).toMatchObject({ success: true, content: { kind: 'other', adapterHealthy: true, title: 'fixture ready' } });
});

test('external links are routed to the system browser', async () => {
  await inMain((t) => t.xView.webContents.executeJavaScript("document.getElementById('ext').click()"));
  await expect.poll(() => inMain((t) => t.openExternalCalls)).toContain('https://example.com/outside');
});

test('both preloads are self-contained bundles and the React header renders', async () => {
  for (const name of ['sidebar', 'x']) {
    const built = readFileSync(resolve(`out/preload/${name}.js`), 'utf8');
    // A sandboxed preload can require() only electron and node builtins.
    expect(built, name).not.toMatch(/require\("\.\//);
    expect(built, name).not.toMatch(/require\("zod"\)/);
  }
  await expect.poll(() => inMain((t) => t.sidebar.webContents.executeJavaScript('typeof window.xpilot')), { timeout: 15_000 }).toBe('object');
  await expect.poll(() => inMain((t) => t.sidebar.webContents.executeJavaScript("document.querySelector('.brand')?.textContent ?? null")), { timeout: 15_000 }).toBe('XPilot');
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
