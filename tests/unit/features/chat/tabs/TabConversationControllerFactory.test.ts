import type { Conversation } from '@/core/types';
import { resolveSubagentTranscriptSessionId } from '@/features/chat/tabs/TabConversationControllerFactory';

describe('resolveSubagentTranscriptSessionId', () => {
  it('falls back to the persisted conversation session after plugin reload', () => {
    const conversation = {
      id: 'conversation-1',
      providerId: 'claude',
      title: 'Transcript',
      createdAt: 0,
      lastActivityAt: 0,
      messages: [],
      sessionId: 'persisted-session',
      providerState: { providerSessionId: 'provider-session' },
    } as Conversation;

    expect(resolveSubagentTranscriptSessionId(null, conversation)).toBe('persisted-session');
  });
});
