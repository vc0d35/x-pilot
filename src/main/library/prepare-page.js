// Prepares an x.com post/article page for printing. Evaluated in the page; must stay dependency-free.
async ({ timeoutMs }) => {
  const SEL = {
    article: 'article[data-testid="tweet"]',
    articleView: '[data-testid="twitterArticleReadView"], [data-testid="twitterArticleRichTextView"]',
    showMore: '[data-testid="tweet-text-show-more-link"]',
    permalink: 'a[href*="/status/"] time',
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + timeoutMs;
  while (!document.querySelector(SEL.article) && !document.querySelector(SEL.articleView)) {
    if (Date.now() > deadline) throw new Error('No post rendered before the timeout');
    await sleep(100);
  }
  for (const el of document.querySelectorAll(SEL.showMore)) el.click();
  await sleep(300);
  const css = document.createElement('style');
  css.id = 'xpilot-print-css';
  css.textContent = `
    header[role="banner"], [data-testid="sidebarColumn"], [data-testid="BottomBar"], [data-testid="DMDrawer"],
    [data-testid="primaryColumn"] > div > div:first-child, [data-testid="inline_reply_offscreen"], [data-testid="tweetTextarea_0"],
    [aria-label="Timeline: Trending now"], [data-testid="toast"] { display: none !important; }
    body, main, [data-testid="primaryColumn"] { width: 100% !important; max-width: 100% !important; border: none !important; }
    article { break-inside: avoid; }
  `;
  document.head.appendChild(css);
  const m = /^\/([^/]+)\/status\/(\d+)/.exec(location.pathname) || /^\/(?:i|[^/]+)\/article\/(\d+)/.exec(location.pathname);
  let author = m && m.length === 3 ? m[1] : '';
  let id = m ? m[m.length - 1] : '';
  if (!author) {
    const first = document.querySelector(SEL.article);
    const link = first && first.querySelector(SEL.permalink);
    const href = link && link.closest('a') && link.closest('a').getAttribute('href');
    const pm = href && /^\/([^/]+)\/status\/(\d+)/.exec(href);
    if (pm) { author = pm[1]; id = id || pm[2]; }
  }
  return { title: document.title, author, id };
}
