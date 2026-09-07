export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolves when `check` returns a truthy value; polls every 100 ms and also reacts to DOM mutations. */
export function waitFor(check: () => Element | boolean | null, timeoutMs: number, root: Node = document): Promise<void> {
  return new Promise((resolve, reject) => {
    if (check()) return resolve();
    const done = (ok: boolean) => { clearInterval(iv); clearTimeout(to); obs.disconnect(); ok ? resolve() : reject(new Error('Timed out waiting for page content')); };
    const obs = new MutationObserver(() => { if (check()) done(true); });
    obs.observe(root, { childList: true, subtree: true });
    const iv = setInterval(() => { if (check()) done(true); }, 100);
    const to = setTimeout(() => done(false), timeoutMs);
  });
}

/** Clicks every "Show more" link under root. Returns how many were clicked. */
export function expandShowMore(root: ParentNode, selector: string): number {
  const links = [...root.querySelectorAll<HTMLElement>(selector)];
  for (const l of links) l.click();
  return links.length;
}
