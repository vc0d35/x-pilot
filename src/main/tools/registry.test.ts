import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry, AppToolSource, type ToolSource } from './registry';
import { ok, type ToolModule } from '../../shared/tools';

const echo: ToolModule<{ prefix: string }> = {
  spec: { name: 'xpilot_echo', description: 'echo', inputSchema: { type: 'object', properties: { s: { type: 'string' } } } },
  execute: async (args, ctx) => ok(`${ctx.prefix}${String(args.s)}`),
};

describe('ToolRegistry', () => {
  it('lists tools from all sources and calls the right one', async () => {
    const reg = new ToolRegistry();
    reg.addSource(new AppToolSource('app', [echo], { prefix: '>' }));
    expect(reg.list().map((t) => t.name)).toEqual(['xpilot_echo']);
    await expect(reg.call('xpilot_echo', { s: 'hi' })).resolves.toEqual({ success: true, content: '>hi' });
  });

  it('returns a failure for unknown tools instead of throwing', async () => {
    const reg = new ToolRegistry();
    await expect(reg.call('nope', {})).resolves.toEqual({ success: false, error: 'Unknown tool: nope' });
  });

  it('converts thrown errors into failures', async () => {
    const reg = new ToolRegistry();
    const boom: ToolModule<void> = { spec: { name: 'xpilot_boom', description: 'b', inputSchema: {} }, execute: async () => { throw new Error('kaboom'); } };
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
      execute: async (_args, _ctx, signal) => { seen.push(signal); return ok(signal?.aborted ?? null); },
    };
    reg.addSource(new AppToolSource('app', [watcher], undefined));
    const src: ToolSource = { id: 's', list: () => [{ name: 'x_direct', description: 'd', inputSchema: {} }], call: async (_n, _a, signal) => { seen.push(signal); return ok(null); } };
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
    const src: ToolSource = { id: 's', list: () => [], call: async () => ok(null), onChange: (cb) => { notify = cb; return () => {}; } };
    const spy = vi.fn();
    reg.onChange(spy);
    reg.addSource(src);          // adding a source counts as a change
    notify();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
