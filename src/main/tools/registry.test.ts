import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry, AppToolSource, type ToolSource } from './registry';
import { defineTool, ok, type ToolModule } from '../../shared/tools';
import { readTimeline } from './xview/engage';
import { searchHistory } from './app/search-history';
import { adapterToolSpecs } from '../../preload/x/adapter/tools/specs';

const echo = defineTool({
  name: 'xpilot_echo',
  description: 'echo',
  args: z.strictObject({ s: z.string() }),
  execute: async (args, ctx: { prefix: string }) => ok(`${ctx.prefix}${args.s}`),
});

describe('ToolRegistry', () => {
  it('lists tools from all sources and calls the right one', async () => {
    const reg = new ToolRegistry();
    reg.addSource(new AppToolSource('app', [echo], { prefix: '>' }));
    expect(reg.list().map((t) => t.name)).toEqual(['xpilot_echo']);
    await expect(reg.call('xpilot_echo', { s: 'hi' })).resolves.toEqual({ success: true, content: '>hi' });
  });

  it('rejects arguments that do not match the tool schema, before the tool runs', async () => {
    const reg = new ToolRegistry();
    reg.addSource(new AppToolSource('app', [echo], { prefix: '>' }));
    await expect(reg.call('xpilot_echo', { s: 7 })).resolves.toEqual({
      success: false,
      error: 'Invalid arguments for xpilot_echo: s: Invalid input: expected string, received number',
    });
    await expect(reg.call('xpilot_echo', { s: 'hi', extra: 1 })).resolves.toEqual({
      success: false,
      error: 'Invalid arguments for xpilot_echo: Unrecognized key: "extra"',
    });
  });

  it('returns a failure for unknown tools instead of throwing', async () => {
    const reg = new ToolRegistry();
    await expect(reg.call('nope', {})).resolves.toEqual({ success: false, error: 'Unknown tool: nope' });
  });

  it('converts thrown errors into failures', async () => {
    const reg = new ToolRegistry();
    const boom: ToolModule<void> = {
      spec: { name: 'xpilot_boom', description: 'b', inputSchema: {} },
      args: z.strictObject({}),
      execute: async () => {
        throw new Error('kaboom');
      },
    };
    reg.addSource(new AppToolSource('app', [boom], undefined));
    await expect(reg.call('xpilot_boom', {})).resolves.toEqual({ success: false, error: 'kaboom' });
  });

  it('later sources shadow earlier ones by name and removal restores', async () => {
    const reg = new ToolRegistry();
    const a: ToolSource = { id: 'a', list: () => [{ name: 'x_t', description: 'a', inputSchema: {} }], call: async () => ok('a') };
    const b: ToolSource = { id: 'b', list: () => [{ name: 'x_t', description: 'b', inputSchema: {} }], call: async () => ok('b') };
    reg.addSource(a);
    const removeB = reg.addSource(b);
    expect(reg.list()).toHaveLength(1);
    await expect(reg.call('x_t', {})).resolves.toEqual(ok('b'));
    removeB();
    await expect(reg.call('x_t', {})).resolves.toEqual(ok('a'));
  });

  it('hides internal tools from list() by default but includes them with includeInternal', async () => {
    const reg = new ToolRegistry();
    const src: ToolSource = {
      id: 'x',
      list: () => [
        { name: 'x_public', description: 'p', inputSchema: {} },
        { name: 'x_internal', description: 'i', inputSchema: {}, annotations: { internal: true } },
      ],
      call: async (name) => ok(name),
    };
    reg.addSource(src);
    expect(reg.list().map((t) => t.name)).toEqual(['x_public']);
    expect(reg.list({ includeInternal: true }).map((t) => t.name)).toEqual(['x_public', 'x_internal']);
  });

  it('rejects calling an internal tool unless allowInternal is set, and has() still reports it', async () => {
    const reg = new ToolRegistry();
    const src: ToolSource = {
      id: 'x',
      list: () => [{ name: 'x_click_post_button', description: 'i', inputSchema: {}, annotations: { internal: true } }],
      call: async (name) => ok(name),
    };
    reg.addSource(src);
    expect(reg.has('x_click_post_button')).toBe(true);
    await expect(reg.call('x_click_post_button', {})).resolves.toEqual({ success: false, error: 'Tool is internal: x_click_post_button' });
    await expect(reg.call('x_click_post_button', {}, { allowInternal: true })).resolves.toEqual(ok('x_click_post_button'));
  });

  it('forwards the abort signal to the module and to plain sources', async () => {
    const reg = new ToolRegistry();
    const seen: Array<AbortSignal | undefined> = [];
    const watcher: ToolModule<void> = {
      spec: { name: 'xpilot_watch', description: 'w', inputSchema: {} },
      args: z.strictObject({}),
      execute: async (_args, _ctx, signal) => {
        seen.push(signal);
        return ok(signal?.aborted ?? null);
      },
    };
    reg.addSource(new AppToolSource('app', [watcher], undefined));
    const src: ToolSource = {
      id: 's',
      list: () => [{ name: 'x_direct', description: 'd', inputSchema: {} }],
      call: async (_n, _a, signal) => {
        seen.push(signal);
        return ok(null);
      },
    };
    reg.addSource(src);
    const ac = new AbortController();
    ac.abort();
    await expect(reg.call('xpilot_watch', {}, { signal: ac.signal })).resolves.toEqual(ok(true));
    await reg.call('x_direct', {}, { signal: ac.signal });
    await reg.call('xpilot_watch', {});
    expect(seen).toEqual([ac.signal, ac.signal, undefined]);
  });

  it('propagates change notifications from sources', () => {
    const reg = new ToolRegistry();
    let notify = () => {};
    const src: ToolSource = {
      id: 's',
      list: () => [],
      call: async () => ok(null),
      onChange: (cb) => {
        notify = cb;
        return () => {};
      },
    };
    const spy = vi.fn();
    reg.onChange(spy);
    reg.addSource(src); // adding a source counts as a change
    notify();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

/**
 * The schemas are derived from zod now, but they are still the contract the model was given. These
 * three cover what the derivation has to get right: a shared argument fragment, bounds, defaults,
 * per-property descriptions, the required list and the annotations. The literals are the ones the
 * tools shipped with before the schemas were derived.
 */
describe('the JSON schema the model sees', () => {
  const VIEW = {
    type: 'string',
    enum: ['background', 'visible'],
    description:
      'Where to run: "background" (default) reads in a hidden window and leaves the user\'s screen untouched; "visible" drives the window the user is looking at. Use "visible" only when the user asked to see, open, or browse something.',
  };

  it('x_read_timeline: an enum, a bounded integer and the shared view argument', () => {
    expect(readTimeline.spec.inputSchema).toEqual({
      type: 'object',
      properties: {
        tab: { type: 'string', enum: ['for_you', 'following'] },
        pages: { type: 'integer', minimum: 1, maximum: 10, description: 'How many screens to scroll (default 3)' },
        view: VIEW,
      },
      additionalProperties: false,
    });
    expect(readTimeline.spec.annotations).toEqual({ readOnlyHint: true });
  });

  it('xpilot_search_history: described properties, a default and a required list', () => {
    expect(searchHistory.spec.inputSchema).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text; each word is a prefix match.' },
        author: { type: 'string', description: 'Handle without @' },
        since: { type: 'string', description: 'ISO date; only likes on/after' },
        until: { type: 'string', description: 'ISO date; only likes on/before' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      required: ['query'],
      additionalProperties: false,
    });
  });

  it('x_like_in_page: the preload half, defaults and all', () => {
    expect(adapterToolSpecs.find((s) => s.name === 'x_like_in_page')).toEqual({
      name: 'x_like_in_page',
      description: 'Internal: like or unlike a post rendered in this window by post URL or id.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          action: { type: 'string', enum: ['like', 'unlike'] },
          timeoutMs: { type: 'integer', default: 8000 },
        },
        required: ['url'],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, internal: true },
    });
  });
});
