import { projectTranscript } from '@/core/transcript/TranscriptProjection';
import type { ChatMessage, ContentBlock } from '@/core/types';

describe('projectTranscript', () => {
  it('groups automatic assistant runs under their originating canonical user turn', () => {
    const messages: ChatMessage[] = [
      { id: 'user-1', role: 'user', content: 'Inspect this.', timestamp: 1 },
      {
        id: 'assistant-1', role: 'assistant', content: 'Checking.', timestamp: 2,
        contentBlocks: [{ type: 'text', content: 'Checking.' }],
      },
      {
        id: 'assistant-auto-1', role: 'assistant', isAutomaticResponse: true,
        content: 'Background result.', timestamp: 3,
        contentBlocks: [{ type: 'text', content: 'Background result.' }],
      },
      { id: 'user-2', role: 'user', content: 'Next question.', timestamp: 4 },
      {
        id: 'assistant-2', role: 'assistant', content: 'Next answer.', timestamp: 5,
        contentBlocks: [{ type: 'text', content: 'Next answer.' }],
      },
    ];

    const projection = projectTranscript(messages);

    expect(projection[0].userMessage).toBe(messages[0]);
    expect(projection[0].runs[0].message).toBe(messages[1]);
    expect(projection[0].blocks.map((block) => [block.runId, block.block.type])).toEqual([
      ['assistant-1', 'text'],
      ['assistant-auto-1', 'text'],
    ]);

    expect(projection.map((turn) => ({
      id: turn.id,
      userMessageId: turn.userMessageId,
      runs: turn.runs.map((run) => ({ id: run.id, turnId: run.turnId, automatic: run.isAutomaticResponse })),
    }))).toEqual([
      {
        id: 'user-1',
        userMessageId: 'user-1',
        runs: [
          { id: 'assistant-1', turnId: 'user-1', automatic: false },
          { id: 'assistant-auto-1', turnId: 'user-1', automatic: true },
        ],
      },
      {
        id: 'user-2',
        userMessageId: 'user-2',
        runs: [{ id: 'assistant-2', turnId: 'user-2', automatic: false }],
      },
    ]);
  });

  it('gives a live block the same stable identity after it is committed', () => {
    const committed: ChatMessage = {
      id: 'assistant-live',
      role: 'assistant',
      content: 'Done.',
      timestamp: 1,
      toolCalls: [{ id: 'tool-1', name: 'Read', input: {}, status: 'completed' }],
      contentBlocks: [
        { type: 'thinking', content: 'Review the file.' },
        { type: 'tool_use', toolId: 'tool-1' },
      ],
    };
    const liveBlock: ContentBlock = { type: 'text', content: 'Done.' };

    const liveRun = projectTranscript([committed], {
      activeMessageId: committed.id,
      liveBlock,
      executionScope: { executionId: 'execution-7', turnId: 'execution-turn-9' },
    })[0].runs[0];
    const settledRun = projectTranscript([{
      ...committed,
      contentBlocks: [...committed.contentBlocks!, liveBlock],
    }])[0].runs[0];

    expect(liveRun.status).toBe('streaming');
    expect(liveRun).toMatchObject({
      id: committed.id,
      turnId: committed.id,
      executionId: 'execution-7',
      executionTurnId: 'execution-turn-9',
    });
    expect(liveRun.blocks.map((item) => item.id)).toEqual(settledRun.blocks.map((item) => item.id));
    expect(liveRun.blocks[1].toolCall).toMatchObject({ id: 'tool-1', name: 'Read' });
    expect(liveRun.blocks[2]).toMatchObject({
      blockIndex: 2,
      block: liveBlock,
    });
  });

  it('projects legacy assistant content and interrupted runs without mutating messages', () => {
    const message: ChatMessage = {
      id: 'assistant-legacy',
      role: 'assistant',
      content: 'Partial response.',
      timestamp: 1,
      isInterrupt: true,
    };

    const run = projectTranscript([message])[0].runs[0];

    expect(run).toMatchObject({ id: message.id, turnId: message.id, status: 'interrupted' });
    expect(run.blocks).toEqual([{
      id: 'assistant-legacy:block:0',
      messageId: message.id,
      runId: message.id,
      turnId: message.id,
      blockIndex: 0,
      block: { type: 'text', content: 'Partial response.' },
    }]);
    expect(message.contentBlocks).toBeUndefined();
  });

  it('prefers a persisted content block ID and keeps it after JSON round-trip', () => {
    const message: ChatMessage = {
      id: 'assistant-persisted-block-id',
      role: 'assistant',
      content: 'Answer',
      timestamp: 1,
      contentBlocks: [{ id: 'block-persisted-42', type: 'text', content: 'Answer' }],
    };

    const restored = JSON.parse(JSON.stringify(message)) as ChatMessage;

    expect(projectTranscript([restored])[0].runs[0].blocks[0].id).toBe('block-persisted-42');
  });
});
