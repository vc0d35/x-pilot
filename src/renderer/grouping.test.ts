import { describe, it, expect } from 'vitest';
import { groupEntries } from './grouping';
import type { Entry } from './state';

const msg = (id: string): Entry => ({ kind: 'message', message: { id, role: 'agent', text: id } });
const tool = (id: string, name = 'x_search'): Entry => ({ kind: 'tool', call: { id, name, args: {}, status: 'done' } });

describe('groupEntries', () => {
  it('folds consecutive tool calls into one group and leaves other entries alone', () => {
    const out = groupEntries([msg('m1'), tool('t1'), tool('t2', 'web_search'), msg('m2'), tool('t3')]);
    expect(out.map((g) => g.kind)).toEqual(['message', 'tools', 'message', 'tools']);
    const first = out[1] as { kind: 'tools'; calls: unknown[]; key: string };
    expect(first.calls).toHaveLength(2);
    expect(first.key).toBe('t1');
  });
  it('returns an empty list for no entries', () => {
    expect(groupEntries([])).toEqual([]);
  });
});
