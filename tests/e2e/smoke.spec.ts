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
      XPILOT_START_URL: pathToFileURL(resolve('tests/fixtures/webmcp-page.html')).href,
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

type Harness = { sidebar: { webContents: { executeJavaScript(c: string): Promise<unknown> } }; registry: { list(): { name: string }[]; call(n: string, a: object): Promise<{ success: boolean; content?: unknown; error?: string }> }; openExternalCalls: string[]; xView: { webContents: { executeJavaScript(c: string): Promise<unknown> } } };
const inMain = <T,>(fn: (t: Harness) => T | Promise<T>) => app.evaluate(async (_electron, fnSrc: string) => {
  const t = (globalThis as { __xpilotTest?: Harness }).__xpilotTest!;
  return (new Function('t', `return (${fnSrc})(t)`))(t);
}, fn.toString());

test('preload registers adapter tools and the page registers a WebMCP tool', async () => {
  await expect.poll(() => inMain((t) => t.registry.list().map((x) => x.name)), { timeout: 15_000 }).toContain('x_get_page_state');
  await expect.poll(() => inMain(async (t) => { const r = await t.registry.call('x_list_page_tools', {}); return (r.content as { name: string }[]).map((x) => x.name); })).toEqual(['demo-echo']);
  const echoed = await inMain((t) => t.registry.call('x_call_page_tool', { name: 'demo-echo', args: { s: 'hi' } }));
  expect(echoed).toEqual({ success: true, content: { echoed: 'hi', title: 'fixture ready' } });
});

test('x_get_page_state works on a non-x.com page', async () => {
  const r = await inMain((t) => t.registry.call('x_get_page_state', {}));
  expect(r).toMatchObject({ success: true, content: { kind: 'other', adapterHealthy: true, title: 'fixture ready' } });
});

test('external links are routed to the system browser', async () => {
  await inMain((t) => t.xView.webContents.executeJavaScript("document.getElementById('ext').click()"));
  await expect.poll(() => inMain((t) => t.openExternalCalls)).toContain('https://example.com/outside');
});

test('the sidebar preload loads and the React header renders', async () => {
  const built = readFileSync(resolve('out/preload/sidebar.js'), 'utf8');
  expect(built).not.toMatch(/require\("\.\//); // sandboxed preload must be self-contained
  await expect.poll(() => inMain((t) => t.sidebar.webContents.executeJavaScript('typeof window.xpilot')), { timeout: 15_000 }).toBe('object');
  await expect.poll(() => inMain((t) => t.sidebar.webContents.executeJavaScript("document.querySelector('.brand')?.textContent ?? null")), { timeout: 15_000 }).toBe('X Pilot');
});

// Network-dependent: loads x.com search (logged out) in the hidden session window.
test('x_search runs in the hidden background window without moving the visible view', async () => {
  const before = await inMain((t) => t.xView.webContents.executeJavaScript('location.href'));
  const r = await inMain((t) => t.registry.call('x_search', { query: 'electron' }));
  expect(r.success).toBe(true);
  expect(Array.isArray(r.content)).toBe(true);
  const after = await inMain((t) => t.xView.webContents.executeJavaScript('location.href'));
  expect(after).toBe(before);
});
