import type { ChatMessage, Conversation } from '../../../../../src/core/types';
import { DshConversationHistoryService } from '../../../../../src/providers/dsh/history/DshConversationHistoryService';

describe('DshConversationHistoryService', () => {
  const messages: ChatMessage[] = [
    { content: 'Hello', id: 'user-1', role: 'user', timestamp: 100 },
    {
      assistantMessageId: 'assistant-1',
      content: 'Hi there.',
      contentBlocks: [{ content: 'Hi there.', type: 'text' }],
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 200,
    },
  ];

  it('persists and restores Claudian transcript alongside the native resume id', async () => {
    const service = new DshConversationHistoryService();
    const conversation = {
      createdAt: 0,
      id: 'conversation-1',
      lastActivityAt: 0,
      messages,
      providerId: 'dsh' as const,
      providerState: { providerSessionId: 'native-session' },
      sessionId: 'native-session',
      title: 'Conversation',
    } as Conversation;

    const providerState = service.buildPersistedProviderState(conversation);
    const restored = {
      ...conversation,
      messages: [],
      providerState,
    };
    await service.hydrateConversationHistory(restored);

    expect(restored.messages).toEqual(messages);
    expect(restored.messages).not.toBe(messages);
    expect(restored.providerState).toEqual(expect.objectContaining({ providerSessionId: 'native-session' }));
  });

  it('preserves the transcript when metadata-only writes have no hydrated messages', () => {
    const service = new DshConversationHistoryService();
    const conversation = {
      createdAt: 0,
      id: 'conversation-1',
      lastActivityAt: 0,
      messages: [],
      providerId: 'dsh' as const,
      providerState: {
        claudianTranscript: { messages, schemaVersion: 1 },
      },
      sessionId: 'native-session',
      title: 'Conversation',
    } as unknown as Conversation;

    expect(service.buildPersistedProviderState(conversation)).toEqual(conversation.providerState);
  });

  it('ignores malformed persisted transcript records', async () => {
    const service = new DshConversationHistoryService();
    const conversation = {
      createdAt: 0,
      id: 'conversation-1',
      lastActivityAt: 0,
      messages: [],
      providerId: 'dsh' as const,
      providerState: {
        claudianTranscript: { messages: [{ role: 'system', content: 42 }], schemaVersion: 1 },
      },
      sessionId: null,
      title: 'Conversation',
    } as unknown as Conversation;

    await service.hydrateConversationHistory(conversation);

    expect(conversation.messages).toEqual([]);
  });
});
