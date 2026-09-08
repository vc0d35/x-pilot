// Evaluate JavaScript inside a page of the RUNNING app over the DevTools Protocol.
// Start the app with XPILOT_CDP_PORT=9222, then:
//   node scripts/inspect.mjs x "document.title"            (the x.com view; also: sidebar | bg | <url substring>)
//   node scripts/inspect.mjs x --screenshot out.png
//   node scripts/inspect.mjs --list
import { chromium } from '@playwright/test';
const port = process.env.XPILOT_CDP_PORT ?? '9222';
const [target, ...rest] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const pages = browser.contexts().flatMap((c) => c.pages());
if (target === '--list' || !target) { for (const p of pages) console.log(p.url()); await browser.close(); process.exit(0); }
const pick = () => {
  if (target === 'sidebar') return pages.find((p) => /localhost:\d+\/?$|out\/renderer\/index\.html/.test(p.url()));
  const xPages = pages.filter((p) => /https:\/\/(x|twitter)\.com/.test(p.url()));
  if (target === 'x') return xPages[0];
  if (target === 'bg') return xPages[1];
  return pages.find((p) => p.url().includes(target));
};
const page = pick();
if (!page) { console.error(`No page for "${target}". Open pages:\n` + pages.map((p) => '  ' + p.url()).join('\n')); await browser.close(); process.exit(1); }
if (rest[0] === '--screenshot') { await page.screenshot({ path: rest[1] ?? 'page.png' }); console.log('wrote', rest[1] ?? 'page.png'); }
else { const result = await page.evaluate(rest.join(' ') || 'document.title'); console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 1)); }
await browser.close();
