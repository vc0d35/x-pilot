import { describe, it, expect, vi } from 'vitest';
import { ApprovalBroker } from '../../approvals';
import type { ApprovalRequest } from '../../../shared/agent';
import type { AppToolCtx } from './context';
import { VIEW_MESSAGE_BYTES_MAX, VIEW_TOOL_ALLOWLIST, type ActiveViewState } from '../../../shared/views';
import { VIEW_API_CONTRACT, VIEW_STARTERS } from '../../views/api';
import {
  activateView,
  deactivateView,
  deleteView,
  listViews,
  readViewFile,
  viewApi,
  viewConsole,
  viewInspect,
  viewMessage,
  viewState,
  writeViewFile,
} from './views';

/** A views store as the tools see it: files in a map, so a test never touches the disk. */
function fakeStore(files: Record<string, Record<string, string>> = {}) {
  return {
    dir: '/profile/views',
    list: () =>
      Object.entries(files).map(([name, entries]) => ({
        name,
        files: Object.keys(entries).length,
        bytes: Object.values(entries).reduce((n, c) => n + c.length, 0),
        hasIndex: 'index.html' in entries,
      })),
    files: (view: string) => Object.keys(files[view] ?? {}),
    exists: (view: string) => view in files,
    hasIndex: (view: string) => 'index.html' in (files[view] ?? {}),
    read: (view: string, path: string) => {
      const content = files[view]?.[path];
      if (content === undefined) throw new Error(`${view}/${path} does not exist`);
      return content;
    },
    write: (view: string, path: string, content: string) => {
      (files[view] ??= {})[path] = content;
      return { path: `/profile/views/${view}/${path}`, bytes: Buffer.byteLength(content) };
    },
    delete: (view: string) => delete files[view],
  };
}

function ctx(
  opts: {
    files?: Record<string, Record<string, string>>;
    mode?: 'confirm' | 'autonomous';
    decision?: string;
    note?: string;
    active?: string | null;
    showFailure?: string | null;
    inspect?: unknown;
    published?: ActiveViewState | null;
  } = {},
) {
  const store = fakeStore(opts.files ?? {});
  const approvals = new ApprovalBroker();
  const asked: ApprovalRequest[] = [];
  approvals.onEvent((e) => {
    if (e.type !== 'approval.requested') return;
    asked.push(e.request);
    if (opts.decision !== 'timeout') approvals.resolve(e.request.id, opts.decision ?? 'keep', opts.note);
  });
  let active: string | null = opts.active ?? null;
  const persisted: (string | null)[] = [];
  const show = vi.fn(async (view: string) => {
    if (opts.showFailure) return opts.showFailure;
    active = view;
    return null;
  });
  const hide = vi.fn(() => {
    active = null;
    previewing = false;
  });
  const failed = vi.fn();
  const messages: Record<string, unknown>[] = [];
  let previewing = false;
  const preview = vi.fn((on: boolean) => {
    previewing = on;
  });
  return {
    store,
    asked,
    approvals,
    show,
    hide,
    preview,
    failed,
    messages,
    previewing: () => previewing,
    persisted,
    value: {
      approvals,
      views: {
        store,
        active: () => active,
        show,
        hide,
        failed,
        preview,
        persist: (view: string | null) => persisted.push(view),
        mode: () => opts.mode ?? 'autonomous',
        logs: () => [{ at: '2026-01-01T00:00:00.000Z', source: 'console' as const, level: 'error', text: 'boom' }],
        state: () => opts.published ?? null,
        message: (data: Record<string, unknown>) => {
          if (!active) return false;
          messages.push(data);
          return true;
        },
        inspect: async () => (opts.inspect === undefined ? null : opts.inspect),
      },
    } as unknown as AppToolCtx,
  };
}

describe('xpilot_list_views and the file tools', () => {
  it('lists what is in the profile and which view is up', async () => {
    const c = ctx({ files: { feed: { 'index.html': '<h1>hi</h1>' } }, active: 'feed' });
    expect(await listViews.execute({}, c.value)).toEqual({
      success: true,
      content: { dir: '/profile/views', active: 'feed', views: [{ name: 'feed', files: 1, bytes: 11, hasIndex: true }] },
    });
  });

  it('reads and writes a file, and reports a refusal as a failure', async () => {
    const c = ctx({ files: { feed: { 'index.html': '<h1>hi</h1>' } } });
    expect(await readViewFile.execute({ view: 'feed', path: 'index.html' }, c.value)).toEqual({
      success: true,
      content: { view: 'feed', path: 'index.html', bytes: 11, content: '<h1>hi</h1>' },
    });
    expect(await readViewFile.execute({ view: 'feed', path: 'nope.html' }, c.value)).toMatchObject({ success: false });
    expect(await writeViewFile.execute({ view: 'feed', path: 'app.js', content: 'x' }, c.value)).toEqual({
      success: true,
      content: { status: 'written', view: 'feed', path: 'app.js', bytes: 1 },
    });
    expect(c.store.read('feed', 'app.js')).toBe('x');
  });
});

describe('xpilot_activate_view', () => {
  it('shows the view and remembers it when views are autonomous, with no card', async () => {
    const c = ctx({ files: { feed: { 'index.html': 'x' } } });
    expect(await activateView.execute({ view: 'feed' }, c.value)).toEqual({ success: true, content: { status: 'kept', view: 'feed' } });
    expect(c.show).toHaveBeenCalledWith('feed');
    expect(c.asked).toEqual([]);
    expect(c.persisted).toEqual(['feed']);
  });

  it('marks a view being previewed and unmarks it once it is kept', async () => {
    const c = ctx({ files: { feed: { 'index.html': 'x' } }, mode: 'confirm' });
    expect(await activateView.execute({ view: 'feed' }, c.value)).toMatchObject({ content: { status: 'kept' } });
    expect(c.preview.mock.calls).toEqual([[true], [false]]);
    expect(c.previewing()).toBe(false);
  });

  it('leaves nothing marked as a preview when the user reverts', async () => {
    const c = ctx({ files: { feed: { 'index.html': 'x' } }, mode: 'confirm', decision: 'revert' });
    await activateView.execute({ view: 'feed' }, c.value);
    expect(c.previewing()).toBe(false);
  });

  it('previews it and keeps it when the user says so', async () => {
    const c = ctx({ files: { feed: { 'index.html': 'x', 'app.js': 'y' } }, mode: 'confirm' });
    expect(await activateView.execute({ view: 'feed' }, c.value)).toMatchObject({ content: { status: 'kept' } });
    expect(c.asked).toEqual([
      expect.objectContaining({
        title: 'Keep this view?',
        summary: 'feed is on screen in place of x.com',
        detail: 'index.html\napp.js',
        options: [
          { id: 'keep', label: 'Keep' },
          { id: 'adjust', label: 'Adjust…', note: true },
          { id: 'revert', label: 'Revert' },
        ],
      }),
    ]);
    // The view was on screen the whole time the card was up, and stays.
    expect(c.hide).not.toHaveBeenCalled();
    expect(c.persisted).toEqual(['feed']);
  });

  it('takes it off and carries the note back when the user wants a change', async () => {
    const c = ctx({ files: { feed: { 'index.html': 'x' } }, mode: 'confirm', decision: 'adjust', note: 'bigger text' });
    expect(await activateView.execute({ view: 'feed' }, c.value)).toMatchObject({
      success: true,
      content: { status: 'adjust_requested', note: 'bigger text', view: 'feed' },
    });
    expect(c.hide).toHaveBeenCalled();
    expect(c.persisted).toEqual([]);
  });

  it('takes it off and calls a revert a decision, not an error', async () => {
    const c = ctx({ files: { feed: { 'index.html': 'x' } }, mode: 'confirm', decision: 'revert' });
    expect(await activateView.execute({ view: 'feed' }, c.value)).toMatchObject({
      success: true,
      content: { status: 'cancelled_by_user' },
    });
    expect(c.hide).toHaveBeenCalled();
  });

  it('says so when the view is not there, has no entry point, or will not load', async () => {
    expect(await activateView.execute({ view: 'feed' }, ctx().value)).toMatchObject({ success: false, error: /no view called/ });
    const noEntry = ctx({ files: { feed: { 'app.js': 'x' } } });
    expect(await activateView.execute({ view: 'feed' }, noEntry.value)).toMatchObject({
      success: false,
      error: /no index.html/,
    });
    // The user asked for this view: they are told the same way a crash is told, and it is forgotten.
    expect(noEntry.failed).toHaveBeenCalledWith('feed', 'load', 'there is no index.html to load');
    const broken = ctx({ files: { feed: { 'index.html': 'x' } }, showFailure: 'ERR_FAILED' });
    expect(await activateView.execute({ view: 'feed' }, broken.value)).toMatchObject({ success: false, error: /ERR_FAILED/ });
    expect(broken.persisted).toEqual([]);
  });
});

describe('xpilot_deactivate_view and xpilot_delete_view', () => {
  it('puts the user back on X and forgets the view', async () => {
    const c = ctx({ files: { feed: { 'index.html': 'x' } }, active: 'feed' });
    expect(await deactivateView.execute({}, c.value)).toEqual({ success: true, content: { status: 'deactivated', wasShowing: 'feed' } });
    expect(c.hide).toHaveBeenCalled();
    expect(c.persisted).toEqual([null]);
  });

  it('asks before deleting, and a refusal leaves the view alone', async () => {
    const c = ctx({ files: { feed: { 'index.html': 'x' } }, decision: 'cancel' });
    expect(await deleteView.execute({ view: 'feed' }, c.value)).toMatchObject({ content: { status: 'cancelled_by_user' } });
    expect(c.asked[0]).toMatchObject({ title: 'Delete this view?', summary: 'feed: 1 files, 1 B' });
    expect(c.store.exists('feed')).toBe(true);
  });

  it('deletes it once the user says so, taking it off the screen if it was up', async () => {
    const c = ctx({ files: { feed: { 'index.html': 'x' } }, active: 'feed', decision: 'delete' });
    expect(await deleteView.execute({ view: 'feed' }, c.value)).toEqual({ success: true, content: { status: 'deleted', view: 'feed' } });
    expect(c.hide).toHaveBeenCalled();
    expect(c.persisted).toEqual([null]);
    expect(c.store.exists('feed')).toBe(false);
  });
});

describe('xpilot_view_console, xpilot_view_inspect and xpilot_view_api', () => {
  it('returns what the view logged', async () => {
    expect(await viewConsole.execute({ view: 'feed', limit: 50 }, ctx().value)).toMatchObject({
      success: true,
      content: { view: 'feed', entries: [{ text: 'boom', source: 'console' }] },
    });
  });

  it('needs a view on screen to inspect one', async () => {
    expect(await viewInspect.execute({ selector: 'li', limit: 5 }, ctx().value)).toMatchObject({
      success: false,
      error: expect.stringContaining('No custom view is on screen'),
    });
    const found = { selector: 'li', matches: 1, elements: [], truncated: false };
    expect(await viewInspect.execute({ selector: 'li', limit: 5 }, ctx({ inspect: found }).value)).toEqual({
      success: true,
      content: found,
    });
    expect(await viewInspect.execute({ selector: '<<', limit: 5 }, ctx({ inspect: { error: 'nope' } }).value)).toEqual({
      success: false,
      error: 'nope',
    });
  });

  it('hands back the contract and starters that already satisfy the view policy', async () => {
    const r = (await viewApi.execute({}, ctx().value)) as { content: { contract: string; starters: typeof VIEW_STARTERS } };
    expect(r.content.contract).toBe(VIEW_API_CONTRACT);
    for (const name of VIEW_TOOL_ALLOWLIST) expect(VIEW_API_CONTRACT).toContain(name);
    for (const starter of Object.values(r.content.starters)) {
      // Inline script is refused by the view CSP, so a starter that used one would never run.
      expect(starter['index.html']).not.toMatch(/<script(?![^>]*\ssrc=)/);
      expect(starter['index.html']).toContain('src="app.js"');
      expect(starter['app.js']).toContain('window.xpilotView');
      // Both halves of the agent's side of a view: what it publishes, and what it can be told.
      expect(starter['app.js']).toContain('window.xpilotView.setState');
      expect(starter['app.js']).toContain("subscribe('message'");
    }
    for (const mentioned of ['setState', 'focus', 'items', 'summary', 'message']) expect(VIEW_API_CONTRACT).toContain(mentioned);
  });
});

describe('xpilot_view_state and xpilot_view_message', () => {
  const published = {
    view: 'reader',
    state: { summary: '42 posts', focus: { url: 'https://x.com/a/status/1', authorHandle: 'a', text: 'hello' } },
    updatedAt: '2026-09-11T10:00:00.000Z',
  };

  it('returns what the view on screen published, and says when there is no view at all', async () => {
    expect(await viewState.execute({}, ctx({ active: 'reader', published }).value)).toEqual({ success: true, content: published });
    expect(await viewState.execute({}, ctx().value)).toEqual({ success: true, content: { view: null } });
  });

  it('delivers a message to the view on screen, and fails when there is none', async () => {
    const c = ctx({ files: { reader: { 'index.html': 'x' } }, active: 'reader' });
    expect(await viewMessage.execute({ data: { type: 'focus', url: 'https://x.com/a/status/1' } }, c.value)).toEqual({
      success: true,
      content: { delivered: true, view: 'reader' },
    });
    expect(c.messages).toEqual([{ type: 'focus', url: 'https://x.com/a/status/1' }]);
    expect(await viewMessage.execute({ data: { type: 'focus' } }, ctx().value)).toMatchObject({
      success: false,
      error: expect.stringContaining('No custom view is on screen'),
    });
  });

  it('refuses a message bigger than the cap rather than handing it over', async () => {
    const c = ctx({ active: 'reader' });
    expect(await viewMessage.execute({ data: { blob: 'x'.repeat(VIEW_MESSAGE_BYTES_MAX) } }, c.value)).toMatchObject({
      success: false,
      error: expect.stringContaining(`${VIEW_MESSAGE_BYTES_MAX / 1024} KB`),
    });
    expect(c.messages).toEqual([]);
  });
});
