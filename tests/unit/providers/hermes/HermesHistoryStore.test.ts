import { projectHermesHistory } from '@/providers/hermes/history/HermesHistoryStore';

describe('Hermes history projection', () => {
  it('restores text, reasoning and tool calls in native row order', () => {
    const messages = projectHermesHistory([
      { id: 1, role: 'user', content: 'Hello', timestamp: 1 },
      { id: 2, role: 'assistant', content: '', reasoning_content: 'Thinking', timestamp: 2,
        tool_calls: JSON.stringify([{ id: 'call-1', function: { name: 'terminal', arguments: '{"command":"pwd"}' } }]) },
      { id: 3, role: 'tool', tool_call_id: 'call-1', content: '/vault', timestamp: 3 },
      { id: 4, role: 'assistant', content: 'Done', timestamp: 4 },
    ], 'session-1');
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(messages[0].content).toBe('Hello');
    expect(messages[1].contentBlocks).toEqual([{ type: 'thinking', content: 'Thinking' }, { type: 'tool_use', toolId: 'call-1' }]);
    expect(messages[1].toolCalls).toEqual([expect.objectContaining({ id: 'call-1', name: 'terminal', input: { command: 'pwd' }, status: 'unknown', result: '/vault' })]);
    expect(messages[2].content).toBe('Done');
  });
  it('does not mark incomplete historical tools as running or claim an unknown result succeeded', () => {
    const call = { id: 'call-1', function: { name: 'write_file', arguments: '{}' } };
    const rows = [{ id: 1, role: 'assistant', content: '', tool_calls: JSON.stringify([call]), timestamp: 1 }];
    expect(projectHermesHistory(rows, 'session-1')[0].toolCalls?.[0].status).toBe('unknown');
    expect(projectHermesHistory([...rows, { id: 2, role: 'tool', tool_call_id: 'call-1', content: 'error', timestamp: 2 }], 'session-1')[0].toolCalls?.[0].status).toBe('unknown');
  });
  it('keeps file tool descriptions readable after restoring a conversation', () => {
    const messages = projectHermesHistory([{ id: 1, role: 'assistant', content: '', tool_calls: JSON.stringify([
      { id: 'call-1', function: { name: 'read_file', arguments: '{"path":"notes/example.md"}' } },
      { id: 'call-2', function: { name: 'write_file', arguments: '{"path":"notes/output.md","content":"x"}' } },
    ]), timestamp: 1 }], 'session-1');
    expect(messages[0].toolCalls?.map(tool => tool.presentation)).toEqual([
      { name: 'read', summary: 'notes/example.md' }, { name: 'write', summary: 'notes/output.md' },
    ]);
  });
  it('restores text and inline image attachments from Hermes structured content', () => {
    const content = '\0json:' + JSON.stringify([{ type: 'text', text: 'Look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }]);
    const messages = projectHermesHistory([{ id: 4, role: 'user', content, timestamp: 1 }], 'session-1');
    expect(messages[0].content).toBe('Look');
    expect(messages[0].images).toEqual([expect.objectContaining({ mediaType: 'image/png', data: 'aGVsbG8=', size: 5 })]);
  });

});
