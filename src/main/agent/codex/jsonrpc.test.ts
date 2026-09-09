import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { JsonRpcStdio, JsonRpcError } from './jsonrpc';

function setup() {
  const toServer = new PassThrough(); // client stdin -> server
  const fromServer = new PassThrough(); // server stdout -> client
  const rpc = new JsonRpcStdio(toServer, fromServer);
  const sent: unknown[] = [];
  toServer.on('data', (c) => {
    for (const line of String(c).split('\n')) if (line.trim()) sent.push(JSON.parse(line));
  });
  const serverSays = (msg: unknown) => fromServer.write(JSON.stringify(msg) + '\n');
  return { rpc, sent, serverSays };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('JsonRpcStdio', () => {
  it('sends requests with incrementing ids and resolves responses', async () => {
    const { rpc, sent, serverSays } = setup();
    const p = rpc.request<{ ok: boolean }>('initialize', { a: 1 });
    await tick();
    expect(sent[0]).toEqual({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { a: 1 } });
    serverSays({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    await expect(p).resolves.toEqual({ ok: true });
  });

  it('rejects with JsonRpcError on error responses', async () => {
    const { rpc, serverSays } = setup();
    const p = rpc.request('x');
    await tick();
    serverSays({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'nope' } });
    await expect(p).rejects.toBeInstanceOf(JsonRpcError);
  });

  it('handles partial lines and multiple messages per chunk', async () => {
    const { rpc, serverSays } = setup();
    const p1 = rpc.request('a');
    const p2 = rpc.request('b');
    await tick();
    const both = JSON.stringify({ jsonrpc: '2.0', id: 1, result: 1 }) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 2, result: 2 }) + '\n';
    (rpc as unknown as { onData(t: string): void }).onData(both.slice(0, 10));
    (rpc as unknown as { onData(t: string): void }).onData(both.slice(10));
    await expect(p1).resolves.toBe(1);
    await expect(p2).resolves.toBe(2);
    void serverSays;
  });

  it('dispatches notifications and answers server requests', async () => {
    const { rpc, sent, serverSays } = setup();
    const notes = vi.fn();
    rpc.onNotification(notes);
    rpc.onRequest(async (method, params) => ({ echoed: method, params }));
    serverSays({ jsonrpc: '2.0', method: 'turn/started', params: { t: 1 } });
    serverSays({ jsonrpc: '2.0', id: 'srv-1', method: 'item/tool/call', params: { tool: 'x' } });
    await tick();
    await tick();
    expect(notes).toHaveBeenCalledWith('turn/started', { t: 1 });
    expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 'srv-1', result: { echoed: 'item/tool/call', params: { tool: 'x' } } });
  });

  it('returns an error response when the request handler throws', async () => {
    const { rpc, sent, serverSays } = setup();
    rpc.onRequest(async () => {
      throw new Error('bad');
    });
    serverSays({ jsonrpc: '2.0', id: 7, method: 'anything', params: {} });
    await tick();
    await tick();
    expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32000, message: 'bad' } });
  });

  it('rejectAll fails every pending request', async () => {
    const { rpc } = setup();
    const p = rpc.request('x');
    rpc.rejectAll(new Error('process exited'));
    await expect(p).rejects.toThrow('process exited');
  });
});
