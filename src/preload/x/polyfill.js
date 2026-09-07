// Main-world polyfill of the W3C WebMCP `modelContext` API, backed by the
// isolated-world bridge exposed by the X preload as `window.__xpilot`.
(() => {
  const bridge = window.__xpilot;
  if (!bridge) return;
  if (document.modelContext && document.modelContext.__xpilotPolyfill) return;

  const tools = new Map(); // name -> { spec, execute }
  const events = new EventTarget();
  const native = navigator.modelContext && !navigator.modelContext.__xpilotPolyfill ? navigator.modelContext : null;
  let ontoolchange = null;

  const toPlain = (v) => {
    if (v === undefined) return null;
    try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); }
  };
  const fireChange = () => {
    const ev = new Event('toolchange');
    events.dispatchEvent(ev);
    if (typeof ontoolchange === 'function') ontoolchange(ev);
  };

  const api = {
    __xpilotPolyfill: true,
    async registerTool(tool, options = {}) {
      if (!tool || typeof tool.name !== 'string' || tool.name.length === 0) throw new TypeError('registerTool: name is required');
      if (typeof tool.description !== 'string' || tool.description.length === 0) throw new TypeError('registerTool: description is required');
      if (typeof tool.execute !== 'function') throw new TypeError('registerTool: execute must be a function');
      if (tools.has(tool.name)) throw new DOMException(`Tool already registered: ${tool.name}`, 'InvalidStateError');
      const spec = { name: tool.name, description: tool.description, inputSchema: toPlain(tool.inputSchema) || { type: 'object', properties: {} } };
      if (tool.annotations) spec.annotations = toPlain(tool.annotations);
      tools.set(tool.name, { spec, execute: tool.execute });
      bridge.registerTool(spec);
      fireChange();
      if (native && typeof native.registerTool === 'function') { try { await native.registerTool(tool, options); } catch (_) { /* native is optional */ } }
    },
    async unregisterTool(name) {
      if (!tools.delete(name)) return;
      bridge.unregisterTool(name);
      fireChange();
      if (native && typeof native.unregisterTool === 'function') { try { await native.unregisterTool(name); } catch (_) { /* optional */ } }
    },
    async getTools() {
      return [...tools.values()].map((t) => ({ ...t.spec }));
    },
    async executeTool(tool, input = {}) {
      const name = typeof tool === 'string' ? tool : tool && tool.name;
      const t = tools.get(name);
      if (!t) throw new DOMException(`Unknown tool: ${name}`, 'NotFoundError');
      const result = await t.execute(input);
      return typeof result === 'string' ? result : JSON.stringify(toPlain(result));
    },
    addEventListener: (...a) => events.addEventListener(...a),
    removeEventListener: (...a) => events.removeEventListener(...a),
    dispatchEvent: (e) => events.dispatchEvent(e),
    get ontoolchange() { return ontoolchange; },
    set ontoolchange(fn) { ontoolchange = typeof fn === 'function' ? fn : null; },
  };

  bridge.onCall((callId, name, args) => {
    const t = tools.get(name);
    if (!t) { bridge.respond(callId, { success: false, error: `Unknown page tool: ${name}` }); return; }
    const onError = (err) => bridge.respond(callId, { success: false, error: err && err.message ? err.message : String(err) });
    try {
      const result = t.execute(args || {});
      // Preserve call order: only defer to a microtask when execute() itself
      // returns a promise; a synchronous result or throw responds immediately.
      if (result && typeof result.then === 'function') {
        result.then((r) => bridge.respond(callId, { success: true, content: toPlain(r) }), onError);
      } else {
        bridge.respond(callId, { success: true, content: toPlain(result) });
      }
    } catch (err) {
      onError(err);
    }
  });

  const desc = { value: api, configurable: true, writable: false, enumerable: false };
  Object.defineProperty(document, 'modelContext', desc);
  Object.defineProperty(navigator, 'modelContext', desc);
})();
