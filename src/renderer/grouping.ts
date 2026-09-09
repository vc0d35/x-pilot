import type { Entry, ToolCall } from './state';

export type RenderGroup = Exclude<Entry, { kind: 'tool' }> | { kind: 'tools'; key: string; calls: ToolCall[] };

export function groupEntries(entries: Entry[]): RenderGroup[] {
  const out: RenderGroup[] = [];
  for (const en of entries) {
    if (en.kind !== 'tool') {
      out.push(en);
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.kind === 'tools') last.calls.push(en.call);
    else out.push({ kind: 'tools', key: en.call.id, calls: [en.call] });
  }
  return out;
}
