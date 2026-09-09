export class JsonRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type RequestHandler = (method: string, params: unknown) => Promise<unknown>;
type NotificationListener = (method: string, params: unknown) => void;

export class JsonRpcStdio {
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<NotificationListener>();
  private requestHandler: RequestHandler = async (method) => {
    throw new JsonRpcError(-32601, `Unhandled server request: ${method}`);
  };

  constructor(
    private readonly stdin: NodeJS.WritableStream,
    stdout: NodeJS.ReadableStream,
  ) {
    stdout.on('data', (chunk) => this.onData(String(chunk)));
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  onNotification(cb: NotificationListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  rejectAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private write(msg: unknown): void {
    this.stdin.write(JSON.stringify(msg) + '\n');
  }

  private onData(text: string): void {
    this.buffer += text;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: Record<string, unknown>): void {
    const hasId = msg.id !== undefined && msg.id !== null;
    if (hasId && typeof msg.method === 'string') {
      const id = msg.id;
      this.requestHandler(msg.method, msg.params)
        .then((result) => this.write({ jsonrpc: '2.0', id, result }))
        .catch((err: unknown) => {
          const code = err instanceof JsonRpcError ? err.code : -32000;
          const message = err instanceof Error ? err.message : String(err);
          this.write({ jsonrpc: '2.0', id, error: { code, message } });
        });
      return;
    }
    if (hasId) {
      const p = this.pending.get(msg.id as number);
      if (!p) return;
      this.pending.delete(msg.id as number);
      if (msg.error) {
        const e = msg.error as { code: number; message: string; data?: unknown };
        p.reject(new JsonRpcError(e.code, e.message, e.data));
      } else p.resolve(msg.result);
      return;
    }
    if (typeof msg.method === 'string') for (const cb of this.listeners) cb(msg.method, msg.params);
  }
}
