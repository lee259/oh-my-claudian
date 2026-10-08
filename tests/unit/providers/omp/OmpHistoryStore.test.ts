import { parseOmpSessionContent } from '@/providers/omp/history/OmpHistoryStore';

describe('parseOmpSessionContent', () => {
  it('projects OMP user and assistant JSONL messages without mutating native data', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 'session-1' }),
      JSON.stringify({
        id: 'user-1',
        message: { content: [{ type: 'text', text: 'Summarize this.' }], role: 'user', timestamp: '2026-08-04T00:00:00.000Z' },
        type: 'message',
      }),
      JSON.stringify({
        id: 'assistant-1',
        message: {
          content: [{ thinking: 'Thinking', type: 'thinking' }, { text: 'Summary', type: 'text' }],
          role: 'assistant',
          timestamp: '2026-08-04T00:00:01.000Z',
        },
        type: 'message',
      }),
    ].join('\n');

    expect(parseOmpSessionContent(content)).toEqual([
      {
        content: 'Summarize this.',
        id: 'user-1',
        role: 'user',
        timestamp: 1785801600000,
        userMessageId: 'user-1',
      },
      {
        assistantMessageId: 'assistant-1',
        content: 'Summary',
        contentBlocks: [
          { content: 'Thinking', type: 'thinking' },
          { content: 'Summary', type: 'text' },
        ],
        id: 'assistant-1',
        role: 'assistant',
        timestamp: 1785801601000,
      },
    ]);
  });

  it('replays native assistant tool calls and separate tool result records in transcript order', () => {
    const content = [
      JSON.stringify({
        id: 'assistant-1',
        message: {
          content: [
            { thinking: 'I should inspect the requested file.', type: 'thinking' },
            { arguments: { path: 'README.md' }, id: 'tool-1', name: 'read', type: 'toolCall' },
          ],
          role: 'assistant',
          timestamp: 1785801601000,
        },
        type: 'message',
      }),
      JSON.stringify({
        id: 'tool-result-1',
        message: {
          content: [{ text: 'README contents', type: 'text' }],
          isError: false,
          role: 'toolResult',
          timestamp: 1785801602000,
          toolCallId: 'tool-1',
          toolName: 'read',
        },
        type: 'message',
      }),
      JSON.stringify({
        id: 'assistant-2',
        message: {
          content: [{ text: 'The README says…', type: 'text' }],
          role: 'assistant',
          timestamp: 1785801603000,
        },
        type: 'message',
      }),
    ].join('\n');

    expect(parseOmpSessionContent(content)).toEqual([
      {
        assistantMessageId: 'assistant-1',
        content: '',
        contentBlocks: [
          { content: 'I should inspect the requested file.', type: 'thinking' },
          { toolId: 'tool-1', type: 'tool_use' },
        ],
        id: 'assistant-1',
        role: 'assistant',
        timestamp: 1785801601000,
        toolCalls: [
          {
            id: 'tool-1',
            input: { path: 'README.md', file_path: 'README.md' },
            name: 'Read',
            providerPayload: { rawInput: { path: 'README.md' }, rawName: 'read' },
            result: 'README contents',
            status: 'completed',
          },
        ],
      },
      {
        assistantMessageId: 'assistant-2',
        content: 'The README says…',
        contentBlocks: [{ content: 'The README says…', type: 'text' }],
        id: 'assistant-2',
        role: 'assistant',
        timestamp: 1785801603000,
      },
    ]);
  });
});
