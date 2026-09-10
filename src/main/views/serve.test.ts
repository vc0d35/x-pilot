import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIB_FILES, VIEW_CSP, resolveLibRequest, resolveViewRequest, rewriteBareThreeImports, viewOrigin, viewUrl } from './serve';

const ROOT = '/profile/views';

describe('resolveViewRequest', () => {
  it('serves a file of a view', () => {
    expect(resolveViewRequest(ROOT, 'xpilot://views/feed/app.js')).toEqual({
      view: 'feed',
      path: 'app.js',
      file: '/profile/views/feed/app.js',
      contentType: 'text/javascript; charset=utf-8',
    });
  });

  it('serves index.html for the view itself', () => {
    for (const url of ['xpilot://views/feed/', 'xpilot://views/feed'])
      expect(resolveViewRequest(ROOT, url), url).toMatchObject({ file: '/profile/views/feed/index.html', contentType: expect.any(String) });
  });

  it('refuses anything outside the view folder, another host, or a file kind we do not serve', () => {
    for (const url of [
      'xpilot://views/feed/../../settings.json',
      'xpilot://views/feed/%2e%2e/%2e%2e/settings.json',
      'xpilot://views/../secret.html',
      'xpilot://views/',
      'xpilot://views/Feed/index.html',
      'xpilot://sidebar/index.html',
      'xpilot://views/feed/run.sh',
      'https://views/feed/index.html',
      'not a url',
    ])
      expect(resolveViewRequest(ROOT, url), url).toBeNull();
  });

  it('names the view URL and the origin a canvas may stay inside', () => {
    expect(viewUrl('feed')).toBe('xpilot://views/feed/index.html');
    expect(viewOrigin('feed')).toBe('xpilot://views/feed/');
    // Another view's files are outside the prefix, so a canvas cannot walk into one.
    expect(viewUrl('feed-two').startsWith(viewOrigin('feed'))).toBe(false);
  });
});

describe('resolveLibRequest', () => {
  it('serves only the exact names on the shelf', () => {
    expect(resolveLibRequest('/app/node_modules', 'xpilot://lib/three.module.js')).toEqual({
      name: 'three.module.js',
      file: '/app/node_modules/three/build/three.module.js',
      contentType: 'text/javascript; charset=utf-8',
    });
    for (const url of [
      'xpilot://lib/../package.json',
      'xpilot://lib/three/build/three.module.js',
      'xpilot://lib/constructor',
      'xpilot://lib/',
      'xpilot://views/lib/three.module.js',
    ])
      expect(resolveLibRequest('/app/node_modules', url), url).toBeNull();
  });

  it('ships files that are actually in the installed package', () => {
    for (const relative of Object.values(LIB_FILES))
      expect(readFileSync(resolve('node_modules', relative), 'utf8').length).toBeGreaterThan(0);
  });
});

describe('rewriteBareThreeImports', () => {
  it('points the addon at the shelf, because an import map would need an inline script', () => {
    const source = readFileSync(resolve('node_modules', LIB_FILES['OrbitControls.js']), 'utf8');
    expect(source).toMatch(/from 'three'/);
    const rewritten = rewriteBareThreeImports(source);
    expect(rewritten).not.toMatch(/from\s*['"]three['"]/);
    expect(rewritten).toContain("from './three.module.js'");
  });
});

describe('VIEW_CSP', () => {
  it('leaves a view with no network of its own and no inline script', () => {
    expect(VIEW_CSP).toBe(
      "default-src 'none'; script-src 'self' xpilot://lib; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.twimg.com; media-src blob: https://*.twimg.com https://video.twimg.com; font-src 'self' xpilot://lib data:; connect-src 'none'; worker-src 'self' blob:; frame-src 'none'; form-action 'none'; base-uri 'none'",
    );
  });
});
