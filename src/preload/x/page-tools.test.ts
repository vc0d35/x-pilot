import { describe, it, expect, vi } from 'vitest';
import { createPageToolHost } from './page-tools';

describe('createPageToolHost', () => {
  it('tracks registrations from the main world', () => {
    const host = createPageToolHost();
    let changes = 0;
    host.onChange(() => changes++);
    host.bridgeApi.registerTool({ name: 'demo-echo', description: 'd', inputSchema: { type: 'object' } });
    host.bridgeApi.registerTool({ name: 'bad' });                     // ignored: no description
    expect(host.list().map((t) => t.name)).toEqual(['demo-echo']);
    host.bridgeApi.unregisterTool('demo-echo');
    expect(host.list()).toEqual([]);
    expect(changes).toBe(2);
  });

  it('routes calls to the main-world callback and resolves on respond', async () => {
    const host = createPageToolHost();
    host.bridgeApi.registerTool({ name: 'echo', description: 'd' });
    host.bridgeApi.onCall((callId, name, args) => { host.bridgeApi.respond(callId, { success: true, content: { name, args } }); });
    await expect(host.call('echo', { s: 1 })).resolves.toEqual({ success: true, content: { name: 'echo', args: { s: 1 } } });
  });

  it('fails for unknown tools, malformed responses and timeouts', async () => {
    const host = createPageToolHost();
    await expect(host.call('nope', {})).resolves.toEqual({ success: false, error: 'Unknown page tool: nope' });
    host.bridgeApi.registerTool({ name: 'slow', description: 'd' });
    let calls = 0;
    host.bridgeApi.onCall((callId) => {
      calls++;
      if (calls === 1) return; // first call: never responds -> timeout
      host.bridgeApi.respond(callId, 'garbage');
    });
    await expect(host.call('slow', {}, 20)).resolves.toEqual({ success: false, error: 'Page tool timed out: slow' });
    await expect(host.call('slow', {}, 100)).resolves.toEqual({ success: false, error: 'Page tool returned a malformed result: slow' });
  });

  it('onCall is first-writer-wins: a later registration is ignored and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = createPageToolHost();
    host.bridgeApi.registerTool({ name: 'echo', description: 'd' });
    const seen: string[] = [];
    host.bridgeApi.onCall(() => seen.push('first'));
    host.bridgeApi.onCall(() => seen.push('second'));
    void host.call('echo', {});
    expect(seen).toEqual(['first']);
    expect(warn).toHaveBeenCalledWith('[xpilot] modelContext bridge already connected');
    warn.mockRestore();
  });
});
