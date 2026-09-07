import { describe, it, expect } from 'vitest';
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
    host.bridgeApi.onCall(() => { /* never responds */ });
    await expect(host.call('slow', {}, 20)).resolves.toEqual({ success: false, error: 'Page tool timed out: slow' });
    host.bridgeApi.onCall((callId) => host.bridgeApi.respond(callId, 'garbage'));
    await expect(host.call('slow', {}, 100)).resolves.toEqual({ success: false, error: 'Page tool returned a malformed result: slow' });
  });
});
