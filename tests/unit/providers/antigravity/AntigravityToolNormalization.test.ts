import { presentAntigravityUpdate } from '@/providers/antigravity/normalization/antigravityToolNormalization';

describe('presentAntigravityUpdate', () => {
  it('presents an unseen tool update as the call it completes', () => {
    const seen = new Set<string>();
    const update = {
      name: 'run_command',
      rawInput: { CommandLine: 'echo done' },
      sessionUpdate: 'tool_call_update' as const,
      status: 'completed' as const,
      toolCallId: 'background-command',
    };

    const presented = presentAntigravityUpdate(seen, update);

    expect(presented).toMatchObject({
      sessionUpdate: 'tool_call',
      title: 'run_command',
      toolCallId: 'background-command',
    });
    expect(seen).toEqual(new Set(['background-command']));
  });

  it('keeps later updates for a call the turn already saw', () => {
    const seen = new Set(['call-1']);
    const update = {
      name: 'write_file',
      sessionUpdate: 'tool_call_update' as const,
      status: 'completed' as const,
      toolCallId: 'call-1',
    };

    expect(presentAntigravityUpdate(seen, update)).toMatchObject({
      sessionUpdate: 'tool_call_update',
      title: 'write_file',
    });
  });
});
