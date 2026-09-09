export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function waitFor(check: () => Element | boolean | null, timeoutMs: number, root: Node = document): Promise<void> {
  return new Promise((resolve, reject) => {
    if (check()) return resolve();
    const done = (ok: boolean) => {
      clearInterval(iv);
      clearTimeout(to);
      obs.disconnect();
      if (ok) resolve();
      else reject(new Error('Timed out waiting for page content'));
    };
    const obs = new MutationObserver(() => {
      if (check()) done(true);
    });
    obs.observe(root, { childList: true, subtree: true });
    const iv = setInterval(() => {
      if (check()) done(true);
    }, 100);
    const to = setTimeout(() => done(false), timeoutMs);
  });
}

export function expandShowMore(root: ParentNode, selector: string): number {
  const links = [...root.querySelectorAll<HTMLElement>(selector)];
  for (const l of links) l.click();
  return links.length;
}
