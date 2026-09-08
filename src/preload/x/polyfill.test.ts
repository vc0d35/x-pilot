// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Indirected through a variable: under the jsdom environment, Vite statically
// rewrites the literal `new URL('./x', import.meta.url)` pattern into a
// dev-server asset URL, which breaks fileURLToPath. Assigning import.meta.url
// to a variable first avoids that rewrite while resolving the same path.
const metaUrl = import.meta.url;
const source = readFileSync(fileURLToPath(new URL('./polyfill.js', metaUrl)), 'utf8');

type Bridge = {
  registered: unknown[]; unregistered: string[]; responses: Array<[string, unknown]>;
  onCallCb: ((callId: string, name: string, args: unknown) => void) | null;
  throwOnRegister: Error | null;
  registerTool(spec: unknown): void; unregisterTool(name: string): void;
  onCall(cb: (callId: string, name: string, args: unknown) => void): void; respond(callId: string, result: unknown): void;
};

type Host = { bridge: Bridge; doc: { modelContext?: any }; nav: { modelContext?: any } };

// The polyfill defines modelContext non-configurably, so each test gets fresh
// window/document/navigator stand-ins passed in as parameters rather than the
// shared jsdom globals.
function install(): Host {
  const bridge: Bridge = {
    registered: [], unregistered: [], responses: [], onCallCb: null, throwOnRegister: null,
    registerTool(spec) { if (this.throwOnRegister) throw this.throwOnRegister; this.registered.push(spec); },
    unregisterTool(name) { this.unregistered.push(name); },
    onCall(cb) { this.onCallCb = cb; },
    respond(callId, result) { this.responses.push([callId, result]); },
  };
  const host: Host = { bridge, doc: {}, nav: {} };
  new Function('window', 'document', 'navigator', source)({ __xpilot: bridge }, host.doc, host.nav);
  return host;
}

let host: Host;
const mc = () => host.doc.modelContext;

describe('modelContext polyfill', () => {
  beforeEach(() => { host = install(); });

  it('defines document.modelContext and navigator.modelContext as the same object', () => {
    expect(mc()).toBeDefined();
    expect(host.nav.modelContext).toBe(mc());
  });

  it('defines modelContext non-configurably so the page cannot swap it out', () => {
    expect(() => Object.defineProperty(host.doc, 'modelContext', { value: { evil: true } })).toThrow(TypeError);
    expect(() => { (host.doc as any).modelContext = { evil: true }; }).toThrow(TypeError);
    expect(mc().__xpilotPolyfill).toBe(true);
  });

  it('registerTool forwards the serialisable spec to the bridge and fires toolchange', async () => {
    let fired = 0;
    mc().addEventListener('toolchange', () => fired++);
    await mc().registerTool({ name: 'demo-echo', description: 'Echoes', inputSchema: { type: 'object', properties: { s: { type: 'string' } } }, execute: ({ s }: { s: string }) => s });
    expect(host.bridge.registered).toEqual([{ name: 'demo-echo', description: 'Echoes', inputSchema: { type: 'object', properties: { s: { type: 'string' } } } }]);
    expect(fired).toBe(1);
    await expect(mc().getTools()).resolves.toEqual([expect.objectContaining({ name: 'demo-echo' })]);
  });

  it('rejects duplicates and invalid tools', async () => {
    await mc().registerTool({ name: 't', description: 'd', execute: () => 1 });
    await expect(mc().registerTool({ name: 't', description: 'd', execute: () => 1 })).rejects.toThrow();
    await expect(mc().registerTool({ name: '', description: 'd', execute: () => 1 })).rejects.toThrow();
    await expect(mc().registerTool({ name: 'u', description: 'd' })).rejects.toThrow();
  });

  it('surfaces a bridge rejection to the page and keeps the tool unregistered', async () => {
    host.bridge.throwOnRegister = new TypeError('Rejected tool registration: name');
    await expect(mc().registerTool({ name: 'bad name', description: 'd', execute: () => 1 })).rejects.toThrow('Rejected tool registration');
    await expect(mc().getTools()).resolves.toEqual([]);
  });

  it('executes tools on bridge calls and responds with success/failure', async () => {
    await mc().registerTool({ name: 'add', description: 'adds', execute: ({ a, b }: { a: number; b: number }) => a + b });
    await mc().registerTool({ name: 'boom', description: 'throws', execute: () => { throw new Error('nope'); } });
    host.bridge.onCallCb!('c1', 'add', { a: 2, b: 3 });
    host.bridge.onCallCb!('c2', 'boom', {});
    host.bridge.onCallCb!('c3', 'missing', {});
    await new Promise((r) => setTimeout(r, 0));
    expect(host.bridge.responses).toEqual([
      ['c1', { success: true, content: 5 }],
      ['c2', { success: false, error: 'nope' }],
      ['c3', { success: false, error: 'Unknown page tool: missing' }],
    ]);
  });

  it('executeTool returns a string and unregisterTool notifies the bridge', async () => {
    await mc().registerTool({ name: 'obj', description: 'd', execute: () => ({ x: 1 }) });
    await expect(mc().executeTool('obj', {})).resolves.toBe('{"x":1}');
    await mc().unregisterTool('obj');
    expect(host.bridge.unregistered).toEqual(['obj']);
    await expect(mc().getTools()).resolves.toEqual([]);
  });
});
