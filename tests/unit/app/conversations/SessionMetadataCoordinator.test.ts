import { createConversationMetadataShell } from '@/app/conversations/SessionMetadataCoordinator';
import type { SessionMetadata } from '@/core/types';

it('restores an optional conversation origin from metadata', () => {
  const origin = { kind: 'fork' as const, sourceConversationId: 'source-1' };
  const metadata: SessionMetadata = {
    id: 'conversation-1',
    providerId: 'claude',
    title: 'Forked',
    createdAt: 1,
    lastActivityAt: 1,
    sessionId: 'session-1',
    origin,
  };

  expect(createConversationMetadataShell(metadata).origin).toEqual(origin);
});
