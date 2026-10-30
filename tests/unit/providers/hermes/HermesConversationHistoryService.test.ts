import type { Conversation } from '@/core/types';
import { HermesConversationHistoryService } from '@/providers/hermes/history/HermesConversationHistoryService';

jest.mock('@/providers/hermes/history/HermesHistoryStore', () => ({
  loadHermesSessionMessages: jest.fn().mockResolvedValue([
    { id: 'u1', userMessageId: 'u1', role: 'user', content: 'Hello Hermes', timestamp: 1 },
    { id: 'a1', assistantMessageId: 'a1', role: 'assistant', content: 'Hello back', timestamp: 2 },
  ]),
}));

describe('Hermes conversation history', () => {
  it('hydrates a saved session before the restored conversation is rendered', async () => {
    const conversation: Conversation = { id: 'c1', providerId: 'hermes', sessionId: 's1', title: 'Hermes', createdAt: 1, lastActivityAt: 2, messages: [] };
    await new HermesConversationHistoryService().hydrateConversationHistory(conversation, null, { environment: { HERMES_HOME: '/isolated' } });
    expect(conversation.messages.map(message => message.content)).toEqual(['Hello Hermes', 'Hello back']);
  });
  it('matches only exact accepted screenshot placeholders and unbound records', () => {
    const service = new HermesConversationHistoryService();
    const message = { id: 'u', role: 'user', content: 'Picture\n[screenshot]', timestamp: 1 } as const;
    const record = { state: 'accepted', canonicalText: 'Picture', images: [{ id: 'image' }] } as never;
    expect(service.matchesLossyUserInput(message, record)).toBe(true);
    expect(service.matchesLossyUserInput({ ...message, content: 'Different\n[screenshot]' }, record)).toBe(false);
    expect(service.matchesLossyUserInput({ ...message, content: 'Picture\n[screenshot]\n[screenshot]' }, record)).toBe(false);
    expect(service.matchesLossyUserInput(message, { ...record as object, state: 'staged' } as never)).toBe(false);
  });
});
