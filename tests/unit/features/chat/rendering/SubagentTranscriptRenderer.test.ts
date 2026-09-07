import { createMockEl } from '@test/helpers/MockElement';

import type { ChatMessage } from '@/core/types';
import { renderSubagentTranscriptMessages } from '@/features/chat/rendering/SubagentTranscriptRenderer';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'hello',
    timestamp: 1000,
    ...overrides,
  } as ChatMessage;
}

describe('renderSubagentTranscriptMessages', () => {
  it('renders one bordered entry per message with a role label', () => {
    const container = createMockEl();
    renderSubagentTranscriptMessages(container, [
      message({ id: 'a', role: 'user', content: 'hi there' }),
      message({ id: 'b', role: 'assistant', content: '**bold** result' }),
    ], {});

    const entries = container.querySelectorAll('.claudian-subagent-transcript-entry');
    expect(entries.length).toBe(2);
    expect(container.querySelector('.claudian-subagent-transcript-entry-role')?.textContent)
      .toBe('user');
  });

  it('renders text content through the markdown renderer when provided', () => {
    const container = createMockEl();
    const renderMarkdown = jest.fn().mockResolvedValue(undefined);
    renderSubagentTranscriptMessages(
      container,
      [message({ id: 'a', role: 'assistant', content: '```ts\nconst x = 1;\n```' })],
      { renderMarkdown },
    );

    expect(renderMarkdown).toHaveBeenCalledTimes(1);
    const markdownArg = renderMarkdown.mock.calls[0][1];
    expect(markdownArg).toContain('const x = 1');
  });

  it('falls back to plain text when no markdown renderer is configured', () => {
    const container = createMockEl();
    renderSubagentTranscriptMessages(
      container,
      [message({ id: 'a', role: 'user', content: 'plain text' })],
      {},
    );
    const textEl = container.querySelector('.claudian-subagent-transcript-entry-text');
    expect(textEl?.textContent).toBe('plain text');
  });

  it('renders stored tool-call cards for assistant tool calls', () => {
    const container = createMockEl();
    renderSubagentTranscriptMessages(container, [
      message({
        id: 'a',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 't1',
            name: 'Read',
            input: { file_path: '/tmp/a.md' },
            status: 'completed',
          },
        ] as ChatMessage['toolCalls'],
      }),
    ], {});

    expect(container.querySelector('.claudian-tool-call')).toBeTruthy();
  });

  it('does not emit duplicate empty role rows for content-less messages', () => {
    const container = createMockEl();
    renderSubagentTranscriptMessages(
      container,
      [message({ id: 'a', role: 'assistant', content: '   ', toolCalls: undefined })],
      {},
    );
    // No visible text; the entry is skipped entirely.
    expect(container.querySelectorAll('.claudian-subagent-transcript-entry').length).toBe(0);
  });
});
